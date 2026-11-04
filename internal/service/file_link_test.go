package service

import (
	"bytes"
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/internal/storage/local"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
)

// directTestProvider 本地目录模拟配置了公开地址的 S3：可直连，直链为 base/对象路径
type directTestProvider struct {
	storageprovider.StorageProvider
	base string
}

func (p directTestProvider) IsProxy() bool { return false }

func (p directTestProvider) GetURL(_ context.Context, path string, _ time.Duration) (string, error) {
	return p.base + "/" + path, nil
}

type fileLinkEnv struct {
	admin            *model.User
	localID, cdnID   uint   // 本地存储（代理）与模拟 S3（直连 https://cdn.test/p）
	localDir, cdnDir string // 两个存储的目录
}

func setupFileLinkTest(t *testing.T) fileLinkEnv {
	t.Helper()
	_, _, admin := setupAPITokenTest(t)
	localDir, cdnDir := t.TempDir(), t.TempDir()
	rows := []model.StorageProviderModelAndDto{
		{Name: "local", Type: "local", IsDefault: true, StorageProviderConfig: model.StorageProviderConfig{BaseDir: localDir}},
		{Name: "cdn", Type: "s3", StorageProviderConfig: model.StorageProviderConfig{S3Bucket: "b", S3BaseURL: "https://cdn.test/p"}},
	}
	for i := range rows {
		if svcerr := repo.File.CreateStorageProvider(&rows[i]); svcerr != nil {
			t.Fatal(svcerr)
		}
	}
	localProvider, err := local.NewLocalStorageProvider(rows[0])
	if err != nil {
		t.Fatal(err)
	}
	cdnBackend, err := local.NewLocalStorageProvider(model.StorageProviderModelAndDto{StorageProviderConfig: model.StorageProviderConfig{BaseDir: cdnDir}})
	if err != nil {
		t.Fatal(err)
	}
	storage.ReplaceStorageProviders(map[uint]storageprovider.StorageProvider{
		rows[0].ID: localProvider,
		rows[1].ID: directTestProvider{StorageProvider: cdnBackend, base: "https://cdn.test/p"},
	})
	ResetFileLinkCache()
	t.Cleanup(ResetFileLinkCache)
	return fileLinkEnv{admin: admin, localID: rows[0].ID, cdnID: rows[1].ID, localDir: localDir, cdnDir: cdnDir}
}

func saveTestFile(t *testing.T, ctx context.Context, providerID uint, content string) *SavedFile {
	t.Helper()
	saved, svcerr := NewFileService().SaveFile(ctx, &SaveFileInput{Name: "a.png", ProviderID: providerID, Size: int64(len(content)), MimeType: "image/png", Src: strings.NewReader(content)})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	return saved
}

func TestFileLinks(t *testing.T) {
	env := setupFileLinkTest(t)
	ctx := userCtx(env.admin)
	direct := saveTestFile(t, ctx, env.cdnID, "direct")
	proxied := saveTestFile(t, ctx, env.localID, "proxied")

	// 上传始终返回稳定链接
	if direct.URL != tools.GetBaseUrl()+FileLink(direct.ID) {
		t.Fatalf("upload url = %s", direct.URL)
	}
	hash := direct.Hash
	cdnURL := "https://cdn.test/p/" + hash[:4] + "/" + hash

	// 读取：本站的稳定链接（相对 / 带本站域名 / 带文件名）改写为直链，代理存储与其他站点的链接不变
	body := `{"content":"<img src=\"` + FileLink(direct.ID) + `\">![](` + FileLink(direct.ID) + `/a.png)","abs":"` + direct.URL +
		`","proxied":"` + FileLink(proxied.ID) + `","other":"https://other.test` + FileLink(direct.ID) + `","missing":"` + FileLink(9999) + `"}`
	out, ok := RewriteFileLinks([]byte(body))
	if !ok {
		t.Fatal("expected rewrite")
	}
	want := `{"content":"<img src=\"` + cdnURL + `\">![](` + cdnURL + `)","abs":"` + cdnURL +
		`","proxied":"` + FileLink(proxied.ID) + `","other":"https://other.test` + FileLink(direct.ID) + `","missing":"` + FileLink(9999) + `"}`
	if string(out) != want {
		t.Fatalf("rewrite =\n%s\nwant\n%s", out, want)
	}

	// 写入：直链还原为稳定链接，找不到文件记录的直链保持原样
	unknown := "https://cdn.test/p/abcd/abcd" + strings.Repeat("0", 60)
	in := `{"content":"<img src=\"` + cdnURL + `\"> <img src=\"` + unknown + `\">"}`
	normalized, ok := NormalizeFileLinks([]byte(in))
	if !ok || string(normalized) != `{"content":"<img src=\"`+FileLink(direct.ID)+`\"> <img src=\"`+unknown+`\">"}` {
		t.Fatalf("normalize = %s", normalized)
	}
	if _, ok := RewriteFileLinks([]byte(`{"a":"` + FileLink(proxied.ID) + `"}`)); ok {
		t.Fatal("proxied link should stay")
	}
}

func waitStorageMigration(t *testing.T) func() {
	t.Helper()
	done := make(chan struct{}, 1)
	storageMigrationAfterRun = func() { done <- struct{}{} }
	t.Cleanup(func() { storageMigrationAfterRun = nil })
	return func() {
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Fatal("storage migration timeout")
		}
	}
}

func TestStorageMigration(t *testing.T) {
	env := setupFileLinkTest(t)
	admin, localDir := env.admin, env.localDir
	ctx := userCtx(admin)
	a := saveTestFile(t, ctx, env.cdnID, "aaa")
	b := saveTestFile(t, ctx, env.cdnID, "bbbb")
	dup := saveTestFile(t, ctx, env.cdnID, "aaa") // 与 a 内容相同，共用一个存储对象
	cdnURL := func(hash string) string { return "https://cdn.test/p/" + hash[:4] + "/" + hash }

	// 历史数据中的直链
	post := &model.Post{UserID: admin.ID, PostBase: model.PostBase{Title: "p", Content: `<img src="` + cdnURL(a.Hash) + `">`, Cover: cdnURL(b.Hash)}}
	if err := repo.GetDB().Create(post).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.KV.SetKV("site_logo_test", cdnURL(b.Hash)); err != nil {
		t.Fatal(err)
	}

	// 有文件的存储不能改存放位置
	if svcerr := UpdateStorageProvider(env.cdnID, &model.StorageProviderModelAndDto{Name: "cdn", Type: "s3", StorageProviderConfig: model.StorageProviderConfig{S3Bucket: "other", S3BaseURL: "https://cdn.test/p"}}); svcerr == nil || svcerr.Message != "storage_provider_location_locked" {
		t.Fatalf("location change: %v", svcerr)
	}

	// 迁移整个模拟 S3 → 本地
	wait := waitStorageMigration(t)
	status, svcerr := StartStorageMigration(&dto.StorageMigrationReq{SourceProviderID: env.cdnID, TargetProviderID: env.localID})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	if status.State != StorageMigrationRunning {
		t.Fatalf("status = %+v", status)
	}
	wait()
	status, _ = GetStorageMigrationStatus()
	if status.State != StorageMigrationDone || status.Objects != 2 || status.Copied != 2 || status.LinksUpdated != 2 || status.Bytes != 7 {
		t.Fatalf("status = %+v", status)
	}

	// 正文与配置中的直链已还原为稳定链接；文件都在本地存储，读取时保持代理链接
	var got model.Post
	repo.GetDB().First(&got, post.ID)
	if got.Content != `<img src="`+FileLink(a.ID)+`">` || got.Cover != FileLink(b.ID) {
		t.Fatalf("post = %q %q", got.Content, got.Cover)
	}
	if logo := repo.KV.GetStringWithoutErr("site_logo_test", ""); logo != FileLink(b.ID) {
		t.Fatalf("config = %s", logo)
	}
	for _, f := range []*SavedFile{a, b, dup} {
		file, _ := repo.File.GetByID(f.ID)
		if file.ProviderID != env.localID {
			t.Fatalf("file %d provider = %d", f.ID, file.ProviderID)
		}
		data, err := os.ReadFile(filepath.Join(localDir, f.Hash[:4], f.Hash))
		if err != nil || !bytes.Equal(data, []byte(map[string]string{a.Hash: "aaa", b.Hash: "bbbb"}[f.Hash])) {
			t.Fatalf("object %s: %q %v", f.Hash, data, err)
		}
	}
	if _, ok := RewriteFileLinks([]byte(`"` + FileLink(a.ID) + `"`)); ok {
		t.Fatal("migrated file should be proxied")
	}

	// 迁移完成后存储为空，可以删除；本地存储仍有文件，不能删除
	if svcerr := DeleteStorageProvider(env.localID); svcerr == nil {
		t.Fatal("provider in use deleted")
	}
	if svcerr := DeleteStorageProvider(env.cdnID); svcerr != nil {
		t.Fatal(svcerr)
	}
}

func TestStorageMigrationSelectedFiles(t *testing.T) {
	env := setupFileLinkTest(t)
	ctx := userCtx(env.admin)
	a := saveTestFile(t, ctx, env.localID, "aaa")
	b := saveTestFile(t, ctx, env.localID, "bbbb")

	wait := waitStorageMigration(t)
	if _, svcerr := StartStorageMigration(&dto.StorageMigrationReq{TargetProviderID: env.cdnID, FileIDs: []uint{a.ID}}); svcerr != nil {
		t.Fatal(svcerr)
	}
	// 同一时间只运行一个迁移
	if _, svcerr := StartStorageMigration(&dto.StorageMigrationReq{TargetProviderID: env.cdnID, FileIDs: []uint{b.ID}}); svcerr == nil || svcerr.Code != http.StatusConflict {
		t.Fatalf("second migration: %v", svcerr)
	}
	wait()
	status, _ := GetStorageMigrationStatus()
	if status.State != StorageMigrationDone || status.Objects != 1 || status.FileCount != 1 {
		t.Fatalf("status = %+v", status)
	}
	fa, _ := repo.File.GetByID(a.ID)
	fb, _ := repo.File.GetByID(b.ID)
	if fa.ProviderID != env.cdnID || fb.ProviderID != env.localID {
		t.Fatalf("providers = %d %d", fa.ProviderID, fb.ProviderID)
	}
	if _, err := os.Stat(filepath.Join(env.cdnDir, a.Hash[:4], a.Hash)); err != nil {
		t.Fatal(err)
	}
	// 迁到可直连的存储后读取即返回直链
	out, ok := RewriteFileLinks([]byte(`"` + FileLink(a.ID) + `"`))
	if !ok || string(out) != `"https://cdn.test/p/`+a.Hash[:4]+"/"+a.Hash+`"` {
		t.Fatalf("rewrite = %s", out)
	}

	// 修改公开地址：先把内容中旧地址的直链还原为稳定链接
	user := &model.User{Username: "u2", Email: "u2@test.local", AvatarUrl: "https://cdn.test/p/" + a.Hash[:4] + "/" + a.Hash}
	repo.GetDB().Create(user)
	if svcerr := UpdateStorageProvider(env.cdnID, &model.StorageProviderModelAndDto{Name: "cdn2", Type: "s3", StorageProviderConfig: model.StorageProviderConfig{S3Bucket: "b", S3BaseURL: "https://cdn2.test/p"}}); svcerr != nil {
		t.Fatal(svcerr)
	}
	var got model.User
	repo.GetDB().First(&got, user.ID)
	if got.AvatarUrl != FileLink(a.ID) {
		t.Fatalf("avatar = %s", got.AvatarUrl)
	}
}

// 真实 S3 存储：配置公开地址时可直连，直链匹配规则包含前缀；未配置时经后端代理
func TestS3DirectLinkMatcher(t *testing.T) {
	cfg := model.StorageProviderModelAndDto{Type: "s3", StorageProviderConfig: model.StorageProviderConfig{
		S3Bucket: "b", S3AccessKeyID: "k", S3SecretAccessKey: "s", S3Endpoint: "https://s3.test", S3Prefix: "blog", S3BaseURL: "https://cdn.test/",
	}}
	provider, err := storage.NewStorageProvider(cfg)
	if err != nil {
		t.Fatal(err)
	}
	m, ok := newDirectLinkMatcher(5, provider)
	hash := strings.Repeat("c", 64)
	if !ok || m.prefix != "https://cdn.test/blog/" || !m.pattern.MatchString("https://cdn.test/blog/"+hash[:4]+"/"+hash) {
		t.Fatalf("matcher = %+v %v", m, ok)
	}
	cfg.S3BaseURL = ""
	provider, _ = storage.NewStorageProvider(cfg)
	if !provider.IsProxy() {
		t.Fatal("s3 without base url must be proxied")
	}
	if _, ok := newDirectLinkMatcher(5, provider); ok {
		t.Fatal("proxied s3 has no direct links")
	}
}
