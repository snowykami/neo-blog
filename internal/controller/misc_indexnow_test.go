package v1

import (
	"context"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

func TestGetIndexNowKey(t *testing.T) {
	sharedstate.UseMemory()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "indexnow_ctrl.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}

	mc := NewMiscController()
	validKey := "f1e2d3c4b5a697887766554433221100"

	call := func(queryKey string) (int, string) {
		c := app.NewContext(0)
		c.Request.SetRequestURI("/api/v1/misc/indexnow-key?key=" + queryKey)
		mc.GetIndexNowKey(context.Background(), c)
		return c.Response.StatusCode(), string(c.Response.Body())
	}

	// 未配置时返回 404
	if code, _ := call(validKey); code != http.StatusNotFound {
		t.Fatalf("expected 404 when unconfigured, got %d", code)
	}

	// 仅设置 INDEXNOW_KEY 但未开启开关时返回 404（与后台配置页展示严格一致）
	t.Setenv(constant.EnvKeyIndexNowKey, validKey)
	if code, _ := call(validKey); code != http.StatusNotFound {
		t.Fatalf("expected 404 when INDEXNOW_ENABLED not set, got %d", code)
	}

	t.Setenv(constant.EnvKeyIndexNowEnabled, "true")

	// 非法格式或带后缀/空白的探测请求在读取配置前即拦截返回 404
	for _, bad := range []string{"", "short", validKey + ".txt", "../etc/passwd", "00112233445566778899aabbccddeeff"} {
		if code, _ := call(bad); code != http.StatusNotFound {
			t.Fatalf("expected 404 on %q, got %d", bad, code)
		}
	}

	// 密钥完全匹配时返回 200 纯文本
	if code, body := call(validKey); code != http.StatusOK || body != validKey {
		t.Fatalf("expected 200 %q, got %d %q", validKey, code, body)
	}

	// 显式关闭 INDEXNOW_ENABLED 时返回 404
	t.Setenv(constant.EnvKeyIndexNowEnabled, "false")
	if code, _ := call(validKey); code != http.StatusNotFound {
		t.Fatalf("expected 404 when INDEXNOW_ENABLED=false, got %d", code)
	}
}
