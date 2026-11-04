package apiv1

import (
	"bytes"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

type errorResponse struct {
	Status  int    `json:"status"`
	Message string `json:"message"`
	Error   struct {
		Reason   string `json:"reason"`
		Code     string `json:"code"`
		Resource string `json:"resource"`
		Field    string `json:"field"`
		Value    any    `json:"value"`
	} `json:"error"`
}

// 错误响应带有原因枚举、错误码与出错的资源 / 字段，前端据此显示「标签的 slug「aigc」已存在」而不是笼统的创建失败
func TestErrorResponses(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	editor := &model.User{Username: "editor", Email: "editor@test.local", Role: constant.RoleEditor}
	repo.GetDB().Create(editor)
	base := startRoutes(t, registerLabelRoutes)

	call := func(method, path, cookie string, body any) errorResponse {
		t.Helper()
		raw, _ := json.Marshal(body)
		req, _ := http.NewRequest(method, base+path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out errorResponse
		_ = json.NewDecoder(resp.Body).Decode(&out)
		out.Status = resp.StatusCode
		return out
	}

	cookie := loginCookie(t, editor)
	label := map[string]any{"name": "AIGC", "slug": "aigc"}
	if got := call(http.MethodPost, "/label/l", cookie, label); got.Status != http.StatusOK {
		t.Fatalf("create = %+v", got)
	}
	got := call(http.MethodPost, "/label/l", cookie, label)
	if got.Status != http.StatusConflict || got.Message != "slug_already_exists" || got.Error.Reason != "already_exists" ||
		got.Error.Code != "slug_already_exists" || got.Error.Resource != "label" || got.Error.Field != "slug" || got.Error.Value != "aigc" {
		t.Fatalf("duplicate = %+v", got)
	}
	if got := call(http.MethodGet, "/label/l/9999", "", nil); got.Status != http.StatusNotFound || got.Error.Reason != "not_found" || got.Error.Resource != "label" {
		t.Fatalf("not found = %+v", got)
	}
	if got := call(http.MethodPost, "/label/l", "", label); got.Status != http.StatusUnauthorized || got.Error.Reason != "unauthenticated" {
		t.Fatalf("unauthenticated = %+v", got)
	}
}
