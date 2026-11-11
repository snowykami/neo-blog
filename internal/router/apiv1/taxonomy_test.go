package apiv1

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/cloudwego/hertz/pkg/route"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 分类与标签全站共享：编辑者可以新建，改名与删除只开放给管理员（路由层直接拦截）
func TestTaxonomyRoutePermissions(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	editor := &model.User{Username: "editor", Email: "editor@test.local", Role: constant.RoleEditor}
	admin := &model.User{Username: "admin", Email: "admin@test.local", Role: constant.RoleAdmin}
	repo.GetDB().Create(editor)
	repo.GetDB().Create(admin)
	base := startRoutes(t, func(g *route.RouterGroup) {
		registerPostRoutes(g)
		registerLabelRoutes(g)
	})
	editorCookie, adminCookie := loginCookie(t, editor), loginCookie(t, admin)

	call := func(method, path, cookie string, body any) (int, map[string]any) {
		t.Helper()
		raw, _ := json.Marshal(body)
		req, _ := http.NewRequest(method, base+path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Cookie", cookie)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out struct {
			Data map[string]any `json:"data"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out.Data
	}

	for _, kind := range []struct{ create, item string }{{"/post/c", "/post/c/%v"}, {"/label/l", "/label/l/%v"}} {
		status, data := call(http.MethodPost, kind.create, editorCookie, map[string]any{"name": "Go", "slug": "go"})
		if status != http.StatusOK {
			t.Fatalf("editor create %s = %d", kind.create, status)
		}
		item := fmt.Sprintf(kind.item, data["id"])
		if status, _ := call(http.MethodPut, item, editorCookie, map[string]any{"name": "Golang", "slug": "golang"}); status != http.StatusForbidden {
			t.Fatalf("editor rename %s = %d, want 403", item, status)
		}
		if status, _ := call(http.MethodDelete, item, editorCookie, nil); status != http.StatusForbidden {
			t.Fatalf("editor delete %s = %d, want 403", item, status)
		}
		if status, _ := call(http.MethodPut, item, adminCookie, map[string]any{"name": "Golang", "slug": "golang"}); status != http.StatusOK {
			t.Fatalf("admin rename %s = %d", item, status)
		}
		if status, _ := call(http.MethodDelete, item, adminCookie, nil); status != http.StatusOK {
			t.Fatalf("admin delete %s = %d", item, status)
		}
	}
}
