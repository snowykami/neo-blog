package apiv1

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/route"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/internal/storage/local"
	"github.com/snowykami/neo-blog/internal/tasks"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
)

// cdnProvider 本地目录模拟配置了公开地址的 S3
type cdnProvider struct {
	storageprovider.StorageProvider
}

func (cdnProvider) IsProxy() bool { return false }

func (cdnProvider) GetURL(_ context.Context, path string, _ time.Duration) (string, error) {
	return "https://cdn.test/" + path, nil
}

// 写入的 JSON 中直链还原为稳定链接，GET 返回的 JSON 中稳定链接改写为直链
func TestFileLinkMiddleware(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	backend, _ := local.NewLocalStorageProvider(model.StorageProviderModelAndDto{StorageProviderConfig: model.StorageProviderConfig{BaseDir: t.TempDir()}})
	storage.ReplaceStorageProviders(map[uint]storageprovider.StorageProvider{7: cdnProvider{backend}})
	service.ResetFileLinkCache()
	hash := strings.Repeat("ab", 32)
	file := &model.File{Hash: hash, UserID: 1, ProviderID: 7, Name: "a.png", MimeType: "image/png"}
	if err := repo.File.Create(file); err != nil {
		t.Fatal(err)
	}
	stable := service.FileLink(file.ID)
	direct := "https://cdn.test/" + hash[:4] + "/" + hash

	var stored string
	base := startRoutes(t, func(g *route.RouterGroup) {
		g.Use(middleware.UseFileLinks())
		g.POST("/echo", func(ctx context.Context, c *app.RequestContext) {
			stored = string(c.Request.Body())
			c.Data(http.StatusOK, "application/json; charset=utf-8", []byte(stored))
		})
		g.GET("/echo", func(ctx context.Context, c *app.RequestContext) {
			c.Data(http.StatusOK, "application/json; charset=utf-8", []byte(stored))
		})
	})

	resp, err := http.Post(base+"/echo", "application/json", strings.NewReader(`{"content":"<img src=\"`+direct+`\">"}`))
	if err != nil {
		t.Fatal(err)
	}
	posted, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if want := `{"content":"<img src=\"` + stable + `\">"}`; stored != want || string(posted) != want {
		t.Fatalf("stored = %s, post response = %s", stored, posted)
	}
	resp, err = http.Get(base + "/echo")
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if want := `{"content":"<img src=\"` + direct + `\">"}`; string(got) != want {
		t.Fatalf("get = %s", got)
	}

	// 带本站域名的稳定链接（后台「复制链接」得到的地址）存为相对路径，其他站点的同名路径不动
	origin := tools.GetBaseUrl()
	if origin == "" {
		t.Fatal("base url is empty")
	}
	body := `{"icon":"` + origin + stable + `/a.png","other":"https://other.test` + stable + `"}`
	resp, err = http.Post(base+"/echo", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if want := `{"icon":"` + stable + `/a.png","other":"https://other.test` + stable + `"}`; stored != want {
		t.Fatalf("stored = %s, want %s", stored, want)
	}

	// SVG 与附件必须保留站内稳定链接（经后端附带 CSP 沙箱或下载头），不能被改写为对象存储直链
	svgFile := &model.File{Hash: strings.Repeat("cd", 32), UserID: 1, ProviderID: 7, Name: "xss.svg", MimeType: "image/svg+xml"}
	zipFile := &model.File{Hash: strings.Repeat("ef", 32), UserID: 1, ProviderID: 7, Name: "bundle.zip", MimeType: "application/zip"}
	if err := repo.File.Create(svgFile); err != nil {
		t.Fatal(err)
	}
	if err := repo.File.Create(zipFile); err != nil {
		t.Fatal(err)
	}
	mixedBody := `{"svg":"` + service.FileLink(svgFile.ID) + `","zip":"` + service.FileLink(zipFile.ID) + `","png":"` + stable + `"}`
	resp, err = http.Post(base+"/echo", "application/json", strings.NewReader(mixedBody))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	resp, err = http.Get(base + "/echo")
	if err != nil {
		t.Fatal(err)
	}
	gotMixed, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	wantMixed := `{"svg":"` + service.FileLink(svgFile.ID) + `","zip":"` + service.FileLink(zipFile.ID) + `","png":"` + direct + `"}`
	if string(gotMixed) != wantMixed {
		t.Fatalf("mixed get = %s, want %s", gotMixed, wantMixed)
	}
}

// apiCall 发送 JSON 请求并解析响应中的 data
func apiCall(t *testing.T, method, url, cookie, body string, data any) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cookie", cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var envelope struct {
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
		Error   struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&envelope)
	if data != nil && len(envelope.Data) > 0 {
		if err := json.Unmarshal(envelope.Data, data); err != nil {
			t.Fatalf("decode %s: %v", envelope.Data, err)
		}
	}
	return resp.StatusCode, envelope.Error.Code
}

// 管理员通过接口把一个存储整体迁移到另一个存储，迁移后文件仍可通过稳定链接访问
func TestStorageMigrationRoutes(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	source := &model.StorageProviderModelAndDto{Name: "old", Type: "local", IsDefault: true, StorageProviderConfig: model.StorageProviderConfig{BaseDir: t.TempDir()}}
	target := &model.StorageProviderModelAndDto{Name: "new", Type: "local", StorageProviderConfig: model.StorageProviderConfig{BaseDir: t.TempDir()}}
	repo.GetDB().Where("1 = 1").Delete(&model.StorageProviderModelAndDto{})
	for _, p := range []*model.StorageProviderModelAndDto{source, target} {
		if svcerr := repo.File.CreateStorageProvider(p); svcerr != nil {
			t.Fatal(svcerr)
		}
	}
	if err := tasks.ReloadStorageProviders(); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin}
	editor := &model.User{Username: "editor", Email: "editor@test.local", Role: constant.RoleEditor}
	repo.GetDB().Create(admin)
	repo.GetDB().Create(editor)
	adminCookie := loginCookie(t, admin)
	base := startRoutes(t, func(g *route.RouterGroup) {
		g.Use(middleware.UseFileLinks())
		registerFileRoutes(g)
	})

	resp := uploadRequest(t, base+"/file/f", adminCookie, "a.png", []byte("png-bytes"))
	var uploaded struct {
		Data struct {
			ID  uint   `json:"id"`
			URL string `json:"url"`
		} `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&uploaded)
	resp.Body.Close()
	if uploaded.Data.ID == 0 || !strings.HasSuffix(uploaded.Data.URL, service.FileLink(uploaded.Data.ID)) {
		t.Fatalf("upload = %+v", uploaded)
	}

	startBody := fmt.Sprintf(`{"source_provider_id":%d,"target_provider_id":%d}`, source.ID, target.ID)
	if code, _ := apiCall(t, http.MethodPost, base+"/file/migration", loginCookie(t, editor), startBody, nil); code != http.StatusForbidden {
		t.Fatalf("editor start = %d", code)
	}
	var started struct {
		State string `json:"state"`
	}
	if code, errCode := apiCall(t, http.MethodPost, base+"/file/migration", adminCookie, startBody, &started); code != http.StatusOK || started.State != "running" {
		t.Fatalf("start = %d %s %+v", code, errCode, started)
	}
	var status struct {
		Migration struct {
			State   string `json:"state"`
			Objects int    `json:"objects"`
			Copied  int    `json:"copied"`
		} `json:"migration"`
	}
	for range 100 {
		apiCall(t, http.MethodGet, base+"/file/migration", adminCookie, "", &status)
		if status.Migration.State != "running" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if status.Migration.State != "done" || status.Migration.Objects != 1 || status.Migration.Copied != 1 {
		t.Fatalf("status = %+v", status.Migration)
	}

	var list struct {
		Usage map[string]struct {
			Files int `json:"files"`
		} `json:"usage"`
	}
	apiCall(t, http.MethodGet, base+"/file/provider-list", adminCookie, "", &list)
	if list.Usage[fmt.Sprint(target.ID)].Files != 1 || list.Usage[fmt.Sprint(source.ID)].Files != 0 {
		t.Fatalf("usage = %+v", list.Usage)
	}
	// 有文件的存储不能改目录
	moved := fmt.Sprintf(`{"name":"new","type":"local","base_dir":%q}`, t.TempDir())
	if code, errCode := apiCall(t, http.MethodPut, fmt.Sprintf("%s/file/provider/%d", base, target.ID), adminCookie, moved, nil); code != http.StatusBadRequest || errCode != "storage_provider_location_locked" {
		t.Fatalf("location change = %d %s", code, errCode)
	}
	// 稳定链接从新存储读取
	resp, err := http.Get(base + "/file/f/" + fmt.Sprint(uploaded.Data.ID))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(body) != "png-bytes" {
		t.Fatalf("file body = %q", body)
	}
}
