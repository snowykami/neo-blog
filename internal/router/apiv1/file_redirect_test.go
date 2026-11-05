package apiv1

import (
	"context"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/route"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/storage"
	"github.com/snowykami/neo-blog/internal/storage/local"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/storageprovider"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// 可直连的存储：可直接显示的文件跳转到对象的公开地址；附件与 SVG 仍经后端返回；删除后不再从缓存里返回旧记录
func TestFileRedirectsToDirectStorage(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	backend, _ := local.NewLocalStorageProvider(model.StorageProviderModelAndDto{StorageProviderConfig: model.StorageProviderConfig{BaseDir: t.TempDir()}})
	storage.ReplaceStorageProviders(map[uint]storageprovider.StorageProvider{7: cdnProvider{backend}})

	create := func(content, name, mime string) (*model.File, string) {
		hash, _ := utils.FileHashFromStream(strings.NewReader(content))
		dir, file := utils.FilePath(hash)
		if err := backend.Save(context.Background(), filepath.Join(dir, file), strings.NewReader(content)); err != nil {
			t.Fatal(err)
		}
		f := &model.File{Hash: hash, UserID: 1, ProviderID: 7, Name: name, MimeType: mime, Size: int64(len(content))}
		if err := repo.File.Create(f); err != nil {
			t.Fatal(err)
		}
		return f, "https://cdn.test/" + dir + "/" + file
	}
	png, pngURL := create("png-bytes", "a.png", "image/png")
	zip, _ := create("zip-bytes", "report.zip", "application/zip")
	svg, _ := create("<svg></svg>", "icon.svg", "image/svg+xml")

	base := startRoutes(t, func(g *route.RouterGroup) { registerFileRoutes(g) })
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	get := func(path string) (*http.Response, string) {
		t.Helper()
		resp, err := client.Get(base + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return resp, string(body)
	}

	for _, path := range []string{"/file/f/" + utoa(png.ID), "/file/f/" + utoa(png.ID) + "/a.png"} {
		resp, _ := get(path)
		if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != pngURL || !strings.Contains(resp.Header.Get("Cache-Control"), "max-age=86400") {
			t.Fatalf("%s: status %d location %q cache %q", path, resp.StatusCode, resp.Header.Get("Location"), resp.Header.Get("Cache-Control"))
		}
	}
	if resp, body := get("/file/f/" + utoa(zip.ID) + "/report.zip"); resp.StatusCode != http.StatusOK || body != "zip-bytes" ||
		resp.Header.Get("Content-Type") != "application/octet-stream" || !strings.Contains(resp.Header.Get("Content-Disposition"), "report.zip") {
		t.Fatalf("attachment: %d %q %q %q", resp.StatusCode, body, resp.Header.Get("Content-Type"), resp.Header.Get("Content-Disposition"))
	}
	if resp, body := get("/file/f/" + utoa(svg.ID)); resp.StatusCode != http.StatusOK || body != "<svg></svg>" || !strings.Contains(resp.Header.Get("Content-Security-Policy"), "sandbox") {
		t.Fatalf("svg: %d %q %q", resp.StatusCode, body, resp.Header.Get("Content-Security-Policy"))
	}

	if err := repo.File.DeleteByID(png.ID); err != nil {
		t.Fatal(err)
	}
	if resp, _ := get("/file/f/" + utoa(png.ID)); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("deleted file: status %d", resp.StatusCode)
	}
}

func utoa(id uint) string {
	return strconv.FormatUint(uint64(id), 10)
}
