package apiv1

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/internal/storage/local"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
	"github.com/snowykami/neo-blog/pkg/utils"
)

const strictSandbox = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals"

// startPageServer 在随机端口启动与生产相同配置（流式请求体）的 Hertz 服务，只注册页面路由
func startPageServer(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	_ = l.Close()
	h := server.New(server.WithHostPorts(addr), server.WithStreamBody(true), server.WithExitWaitTime(0))
	registerPageRoutes(h.Group("/api/v1"))
	go func() { _ = h.Run() }()
	t.Cleanup(func() { _ = h.Shutdown(context.Background()) })
	for range 50 {
		if conn, err := net.Dial("tcp", addr); err == nil {
			_ = conn.Close()
			return "http://" + addr + "/api/v1"
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("server did not start")
	return ""
}

func loginCookie(t *testing.T, u *model.User) string {
	t.Helper()
	token, _, err := utils.Jwt.New2Tokens(u.ID, "test-session", false)
	if err != nil {
		t.Fatal(err)
	}
	return "token=" + token
}

func uploadRequest(t *testing.T, url, cookie, fileName string, content []byte) *http.Response {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", fileName)
	_, _ = fw.Write(content)
	_ = mw.Close()
	req, _ := http.NewRequest(http.MethodPost, url, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestPageHTMLRoutes(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	t.Setenv(constant.EnvKeyBaseUrl, "http://blog.test")
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	provider, _ := local.NewLocalStorageProvider(model.StorageProviderModelAndDto{IsDefault: true, StorageProviderConfig: model.StorageProviderConfig{BaseDir: t.TempDir()}})
	storage.ReplaceStorageProviders(map[uint]storageprovider.StorageProvider{1: provider})
	admin := &model.User{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin}
	editor := &model.User{Username: "editor", Email: "editor@test.local", Role: constant.RoleEditor}
	repo.GetDB().Create(admin)
	repo.GetDB().Create(editor)
	kind := model.PageKindHTML
	pageID, svcerr := service.NewPageService().CreatePage(context.WithValue(context.Background(), "user_id", admin.ID),
		&dto.CreateOrUpdatePageReq{PageBaseDto: dto.PageBaseDto{Title: "Demo", Slug: "demo"}, Kind: &kind})
	if svcerr != nil {
		t.Fatal(svcerr)
	}
	base := startPageServer(t)
	uploadURL := fmt.Sprintf("%s/page/p/%d/html/versions", base, pageID)

	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	for name, content := range map[string]string{"index.html": "<script type=module src=app.mjs></script>", "app.mjs": "document.title='ok'", "theme.mp3": "0123456789"} {
		w, _ := zw.Create(name)
		_, _ = io.WriteString(w, content)
	}
	_ = zw.Close()

	// 上传只开放给管理员：未登录 401，编辑者 403
	for cookie, want := range map[string]int{"": http.StatusUnauthorized, loginCookie(t, editor): http.StatusForbidden} {
		resp := uploadRequest(t, uploadURL, cookie, "site.zip", zipBuf.Bytes())
		_ = resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("upload with cookie %q: got %d, want %d", cookie, resp.StatusCode, want)
		}
	}
	// 文件包校验失败时在 data.path 中返回出错的文件
	var badZip bytes.Buffer
	bw := zip.NewWriter(&badZip)
	_, _ = bw.Create("../evil.html")
	_ = bw.Close()
	resp := uploadRequest(t, uploadURL, loginCookie(t, admin), "bad.zip", badZip.Bytes())
	var badResp struct {
		Message string            `json:"message"`
		Data    map[string]string `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&badResp)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest || badResp.Message != "page_html_invalid_path" || badResp.Data["path"] != "../evil.html" {
		t.Fatalf("bad zip: %d %+v", resp.StatusCode, badResp)
	}

	resp = uploadRequest(t, uploadURL, loginCookie(t, admin), "site.zip", zipBuf.Bytes())
	var uploaded struct {
		Data dto.PageHTMLVersionDto `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&uploaded)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || uploaded.Data.Version != 1 {
		t.Fatalf("upload: %d %+v", resp.StatusCode, uploaded)
	}
	entryURL := strings.TrimSuffix(base, "/api/v1") + uploaded.Data.URL
	moduleURL := strings.TrimSuffix(entryURL, "index.html") + "app.mjs"

	get := func(url string, header map[string]string) *http.Response {
		req, _ := http.NewRequest(http.MethodGet, url, nil)
		for k, v := range header {
			if k == "Host" {
				req.Host = v
				continue
			}
			req.Header.Set(k, v)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	// 无论是否登录，都在不带 allow-same-origin 的沙箱中运行，且允许不透明源以 CORS 方式加载模块脚本
	for _, url := range []string{entryURL, moduleURL} {
		resp := get(url, map[string]string{"Cookie": loginCookie(t, admin)})
		_ = resp.Body.Close()
		h := resp.Header
		if resp.StatusCode != http.StatusOK ||
			h.Get("Content-Security-Policy") != strictSandbox ||
			h.Get("X-Content-Type-Options") != "nosniff" ||
			h.Get("Access-Control-Allow-Origin") != "*" ||
			h.Get("Access-Control-Allow-Credentials") != "" ||
			h.Get("Cache-Control") != "public, max-age=31536000, immutable" ||
			h.Get("Set-Cookie") != "" {
			t.Fatalf("GET %s: %d %v", url, resp.StatusCode, h)
		}
	}
	if resp := get(moduleURL, nil); resp.Header.Get("Content-Type") != "text/javascript; charset=utf-8" {
		t.Fatalf("module content type %q", resp.Header.Get("Content-Type"))
	}
	// 404 同样带沙箱响应头
	resp = get(strings.TrimSuffix(entryURL, "index.html")+"missing.html", nil)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound || resp.Header.Get("Content-Security-Policy") != strictSandbox {
		t.Fatalf("missing file: %d %v", resp.StatusCode, resp.Header)
	}
	// 音视频拖动进度的 Range 请求
	resp = get(strings.TrimSuffix(entryURL, "index.html")+"theme.mp3", map[string]string{"Range": "bytes=2-5"})
	partial, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent || string(partial) != "2345" || resp.Header.Get("Content-Range") != "bytes 2-5/10" {
		t.Fatalf("range: %d %q %v", resp.StatusCode, partial, resp.Header)
	}

	// 配置独立源后，只有经由该源访问时才放开 allow-same-origin：X-Forwarded-Host 不能放宽，
	// 但经前端代理转发（Host 被改写成独立源、原始主机为站点）时必须收紧
	t.Setenv(constant.EnvKeyPageHTMLOrigin, "https://html.usercontent.test")
	cases := []struct {
		header map[string]string
		want   string
	}{
		{map[string]string{"Host": "html.usercontent.test"}, strictSandbox + " allow-same-origin"},
		{map[string]string{"Host": "html.usercontent.test", "X-Forwarded-Host": "html.usercontent.test"}, strictSandbox + " allow-same-origin"},
		{map[string]string{"Host": "blog.test"}, strictSandbox},
		{map[string]string{"Host": "blog.test", "X-Forwarded-Host": "html.usercontent.test"}, strictSandbox},
		{map[string]string{"Host": "html.usercontent.test", "X-Forwarded-Host": "blog.test"}, strictSandbox},
	}
	for _, c := range cases {
		resp := get(entryURL, c.header)
		_ = resp.Body.Close()
		if got := resp.Header.Get("Content-Security-Policy"); got != c.want {
			t.Errorf("headers %v: CSP %q, want %q", c.header, got, c.want)
		}
	}
	// 与站点同主机名的错误配置被忽略，不会放开 allow-same-origin
	t.Setenv(constant.EnvKeyPageHTMLOrigin, "https://blog.test")
	resp = get(entryURL, map[string]string{"Host": "blog.test"})
	_ = resp.Body.Close()
	if got := resp.Header.Get("Content-Security-Policy"); got != strictSandbox {
		t.Fatalf("misconfigured origin: CSP %q", got)
	}
}
