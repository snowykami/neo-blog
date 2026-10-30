package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/internal/storage/local"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
)

// setupPageHTMLTest 临时数据库 + 本地存储，返回编辑者、管理员与存储目录
func setupPageHTMLTest(t *testing.T) (editor, admin *model.User, storageDir string) {
	t.Helper()
	_, editor, admin = setupAPITokenTest(t)
	storageDir = t.TempDir()
	provider, err := local.NewLocalStorageProvider(model.StorageProviderModelAndDto{
		Name: "local", Type: "local", IsDefault: true, StorageProviderConfig: model.StorageProviderConfig{BaseDir: storageDir},
	})
	if err != nil {
		t.Fatal(err)
	}
	storage.ReplaceStorageProviders(map[uint]storageprovider.StorageProvider{1: provider})
	return editor, admin, storageDir
}

func uploadTestZip(t *testing.T, ctx context.Context, pageID uint, entries ...zipEntry) (*dto.PageHTMLVersionDto, error) {
	t.Helper()
	r := buildZip(t, entries...)
	version, svcerr := NewPageHTMLService().Upload(ctx, &PageHTMLUploadInput{PageID: pageID, FileName: "site.zip", Size: r.Size(), Src: r})
	if svcerr != nil {
		return nil, svcerr
	}
	return version, nil
}

func readServed(t *testing.T, ctx context.Context, pageID uint, key, filePath string) (string, string, int) {
	t.Helper()
	file, svcerr := NewPageHTMLService().OpenFile(ctx, pageID, key, filePath)
	if svcerr != nil {
		return "", "", svcerr.Code
	}
	defer file.File.Close()
	data, err := io.ReadAll(file.File)
	if err != nil {
		t.Fatal(err)
	}
	return string(data), file.ContentType, http.StatusOK
}

// versionKey 从入口地址 /api/v1/page-html/{页面ID}/{版本标识}/{入口} 中取出版本标识
func versionKey(t *testing.T, url string) string {
	t.Helper()
	parts := strings.Split(strings.TrimPrefix(url, constant.ApiPrefix+constant.PageHTMLUriPrefix+"/"), "/")
	if len(parts) < 3 || !isPageHTMLKey(parts[1]) {
		t.Fatalf("unexpected url %s", url)
	}
	return parts[1]
}

func TestPageHTMLPermissions(t *testing.T) {
	editor, admin, _ := setupPageHTMLTest(t)
	pages := NewPageService()
	html := model.PageKindHTML

	// 编辑者不能创建 HTML 页面，也不能把自己的页面改成 HTML 页面
	if _, svcerr := pages.CreatePage(userCtx(editor), &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "x", Slug: "x"}, Kind: &html}); svcerr == nil || svcerr.Code != http.StatusForbidden {
		t.Fatalf("editor create html page: %v", svcerr)
	}
	contentPageID, svcerr := pages.CreatePage(userCtx(editor), &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "c", Slug: "c"}})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	if _, svcerr := pages.UpdatePage(userCtx(editor), &dto.CreateOrUpdatePageReq{ID: contentPageID, Kind: &html}); svcerr == nil || svcerr.Code != http.StatusForbidden {
		t.Fatalf("editor switch to html: %v", svcerr)
	}

	pageID, svcerr := pages.CreatePage(userCtx(admin), &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "Demo", Slug: "demo"}, Kind: &html})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	// 编辑者不能修改 HTML 页面、上传或管理版本
	title := "hacked"
	if _, svcerr := pages.UpdatePage(userCtx(editor), &dto.CreateOrUpdatePageReq{ID: pageID, PageBaseDto: dto.PageBaseDto{Title: title}}); svcerr == nil || svcerr.Code != http.StatusForbidden {
		t.Fatalf("editor update html page: %v", svcerr)
	}
	if _, err := uploadTestZip(t, userCtx(editor), pageID, zipEntry{name: "index.html"}); err == nil || !strings.Contains(err.Error(), "permission_denied") {
		t.Fatalf("editor upload: %v", err)
	}
	if _, svcerr := NewPageHTMLService().ListVersions(userCtx(editor), pageID); svcerr == nil || svcerr.Code != http.StatusForbidden {
		t.Fatalf("editor list versions: %v", svcerr)
	}
	// 只能向 HTML 页面上传
	if _, err := uploadTestZip(t, userCtx(admin), contentPageID, zipEntry{name: "index.html"}); err == nil || !strings.Contains(err.Error(), "page_not_html") {
		t.Fatalf("upload to content page: %v", err)
	}
}

func TestPageHTMLUploadServeAndVersions(t *testing.T) {
	_, admin, storageDir := setupPageHTMLTest(t)
	ctx := userCtx(admin)
	html := model.PageKindHTML
	pageID, svcerr := NewPageService().CreatePage(ctx, &dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "Demo", Slug: "demo"}, Kind: &html})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	// 未上传时没有可展示的版本
	if got, _ := NewPageService().GetPageSlugOrID(context.Background(), "demo"); got.HTMLBundle != nil {
		t.Fatalf("bundle before upload: %+v", got.HTMLBundle)
	}

	v1, err := uploadTestZip(t, ctx, pageID,
		zipEntry{name: "site/index.html", content: "<h1>v1</h1>"},
		zipEntry{name: "site/docs/index.html", content: "docs"},
		zipEntry{name: "site/app.mjs", content: "export default 1"},
	)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	if v1.Version != 1 || !v1.Active || v1.Entry != "index.html" || len(v1.Files) != 3 {
		t.Fatalf("v1 = %+v", v1)
	}
	key1 := versionKey(t, v1.URL)

	// 访客拿到的页面详情带有入口地址；默认为站内相对地址，不放开 allow-same-origin
	pageDto, _ := NewPageService().GetPageSlugOrID(context.Background(), "demo")
	if pageDto.HTMLBundle == nil || pageDto.HTMLBundle.URL != fmt.Sprintf("/api/v1/page-html/%d/%s/index.html", pageID, key1) || pageDto.HTMLBundle.AllowSameOrigin {
		t.Fatalf("bundle = %+v", pageDto.HTMLBundle)
	}

	anon := context.Background()
	if body, contentType, code := readServed(t, anon, pageID, key1, "/index.html"); code != http.StatusOK || body != "<h1>v1</h1>" || contentType != "text/html; charset=utf-8" {
		t.Fatalf("serve index: %d %q %q", code, body, contentType)
	}
	if body, _, code := readServed(t, anon, pageID, key1, "/docs/"); code != http.StatusOK || body != "docs" {
		t.Fatalf("serve dir index: %d %q", code, body)
	}
	if _, contentType, _ := readServed(t, anon, pageID, key1, "/app.mjs"); contentType != "text/javascript; charset=utf-8" {
		t.Fatalf("mjs content type %q", contentType)
	}
	// 清单外的路径、穿越路径、错误的页面 ID 或版本标识一律 404
	notFound := []struct {
		pageID     uint
		key, fpath string
	}{
		{pageID, key1, "/missing.html"},
		{pageID, key1, "/../../../etc/passwd"},
		{pageID, key1, "/site/index.html"},
		{pageID + 1, key1, "/index.html"},
		{pageID, strings.Repeat("a", pageHTMLKeyLength), "/index.html"},
		{pageID, "short", "/index.html"},
		{pageID, "", "/index.html"},
	}
	for _, c := range notFound {
		if _, _, code := readServed(t, anon, c.pageID, c.key, c.fpath); code != http.StatusNotFound {
			t.Errorf("serve %d/%s%s: got %d, want 404", c.pageID, c.key, c.fpath, code)
		}
	}

	// 修改入口：只能指向清单内的 HTML 文件
	htmlService := NewPageHTMLService()
	for _, entry := range []string{"app.mjs", "missing.html", "../index.html"} {
		if _, svcerr := htmlService.UpdateVersion(ctx, &dto.UpdatePageHTMLVersionReq{PageID: pageID, VersionID: v1.ID, Entry: &entry}); svcerr == nil {
			t.Fatalf("entry %q should be rejected", entry)
		}
	}
	docs := "docs/index.html"
	if updated, svcerr := htmlService.UpdateVersion(ctx, &dto.UpdatePageHTMLVersionReq{PageID: pageID, VersionID: v1.ID, Entry: &docs}); svcerr != nil || !strings.HasSuffix(updated.URL, "/docs/index.html") {
		t.Fatalf("update entry: %+v %v", updated, svcerr)
	}

	// 继续上传，超出保留数量的旧版本连同文件一起清理，当前版本为最新上传的版本
	var latest *dto.PageHTMLVersionDto
	for i := 2; i <= constant.PageHTMLKeepVersions+2; i++ {
		latest, err = uploadTestZip(t, ctx, pageID, zipEntry{name: "index.html", content: fmt.Sprintf("v%d", i)})
		if err != nil {
			t.Fatalf("upload v%d: %v", i, err)
		}
	}
	versions, svcerr := htmlService.ListVersions(ctx, pageID)
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	if len(versions) != constant.PageHTMLKeepVersions || versions[0].ID != latest.ID || !versions[0].Active {
		t.Fatalf("versions after prune: %d, first %+v", len(versions), versions[0])
	}
	if _, _, code := readServed(t, anon, pageID, key1, "/index.html"); code != http.StatusNotFound {
		t.Fatalf("pruned version still served: %d", code)
	}
	if _, err := os.Stat(filepath.Join(storageDir, pageHTMLStoragePath(pageID, key1, "index.html"))); !os.IsNotExist(err) {
		t.Fatalf("pruned files left in storage: %v", err)
	}

	// 回退到旧版本
	oldest := versions[len(versions)-1]
	active := true
	if switched, svcerr := htmlService.UpdateVersion(ctx, &dto.UpdatePageHTMLVersionReq{PageID: pageID, VersionID: oldest.ID, Active: &active}); svcerr != nil || !switched.Active {
		t.Fatalf("switch version: %+v %v", switched, svcerr)
	}
	pageDto, _ = NewPageService().GetPageSlugOrID(context.Background(), "demo")
	if pageDto.HTMLBundle.Version != oldest.Version {
		t.Fatalf("active version = %d, want %d", pageDto.HTMLBundle.Version, oldest.Version)
	}

	// 删除页面后版本与文件一并清理，旧地址立即失效
	latestKey := versionKey(t, latest.URL)
	if svcerr := NewPageService().DeletePage(ctx, pageID); svcerr != nil {
		t.Fatal(svcerr)
	}
	if _, _, code := readServed(t, anon, pageID, latestKey, "/index.html"); code != http.StatusNotFound {
		t.Fatalf("deleted page still served: %d", code)
	}
	if remaining, _ := repo.PageHTML.ListByPage(pageID); len(remaining) != 0 {
		t.Fatalf("versions left after page delete: %d", len(remaining))
	}
}

func TestPageHTMLSizeValidation(t *testing.T) {
	cases := []struct {
		mode, ratio string
		height      int
		ok          bool
		wantRatio   string
	}{
		{"", "", 0, true, ""},
		{"fill", "bogus", 0, true, "bogus"}, // 只校验当前模式用到的字段
		{"ratio", "16:9", 0, true, "16:9"},
		{"ratio", " 4 / 3 ", 0, true, "4:3"},
		{"ratio", "16:0", 0, false, ""},
		{"ratio", "16", 0, false, ""},
		{"ratio", "1001:1", 0, false, ""},
		{"height", "", 600, true, ""},
		{"height", "", 50, false, ""},
		{"height", "", 20000, false, ""},
	}
	for _, c := range cases {
		page := &model.Page{PageBase: model.PageBase{HTMLSizeMode: c.mode, HTMLAspectRatio: c.ratio, HTMLHeight: c.height}}
		svcerr := normalizePageHTMLSize(page)
		if (svcerr == nil) != c.ok || (c.ok && page.HTMLAspectRatio != c.wantRatio) {
			t.Errorf("normalizePageHTMLSize(%q, %q, %d) = %v, ratio %q", c.mode, c.ratio, c.height, svcerr, page.HTMLAspectRatio)
		}
	}
}

func TestPageHTMLOrigin(t *testing.T) {
	t.Setenv(constant.EnvKeyBaseUrl, "https://blog.example.com")
	_, _, _ = setupPageHTMLTest(t)
	cases := map[string]string{
		"":                                     "",
		"https://html.example-usercontent.com": "https://html.example-usercontent.com",
		"https://html.example.net:8443/":       "https://html.example.net:8443",
		"https://html.example.net/sub":         "", // 不允许带路径
		"ftp://html.example.net":               "",
		"html.example.net":                     "",
		"https://user@html.example.net":        "",
		"https://blog.example.com":             "", // 与站点同一主机名
		"http://blog.example.com:8889":         "", // 端口不同也不行：Cookie 不按端口隔离
	}
	for raw, want := range cases {
		t.Setenv(constant.EnvKeyPageHTMLOrigin, raw)
		if got := PageHTMLOrigin(); got != want {
			t.Errorf("PageHTMLOrigin(%q) = %q, want %q", raw, got, want)
		}
	}
	t.Setenv(constant.EnvKeyPageHTMLOrigin, "https://html.example-usercontent.com")
	requests := []struct {
		host, forwarded string
		want            bool
	}{
		{"html.example-usercontent.com", "", true},
		{"HTML.example-usercontent.com", "html.example-usercontent.com", true},
		{"blog.example.com", "", false},
		{"", "", false},
		{"blog.example.com", "html.example-usercontent.com", false},
		// 经前端代理转发：Host 被改写成独立源，但原始主机是站点
		{"html.example-usercontent.com", "blog.example.com", false},
		{"html.example-usercontent.com", "html.example-usercontent.com, blog.example.com", false},
	}
	for _, r := range requests {
		if got := IsPageHTMLOriginRequest(r.host, r.forwarded); got != r.want {
			t.Errorf("IsPageHTMLOriginRequest(%q, %q) = %v, want %v", r.host, r.forwarded, got, r.want)
		}
	}
}
