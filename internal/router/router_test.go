package router

import (
	"net/http"
	"path/filepath"
	"testing"

	"github.com/cloudwego/hertz/pkg/common/ut"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// 探针：存活检查始终通过；就绪检查在数据库可用时通过，收到退出信号后失败，让负载均衡先摘掉本实例
func TestProbes(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	status := func(path string) int {
		return ut.PerformRequest(h.Engine, http.MethodGet, path, nil).Result().StatusCode()
	}
	if got := status("/healthz"); got != http.StatusOK {
		t.Fatalf("healthz = %d", got)
	}
	if got := status("/readyz"); got != http.StatusOK {
		t.Fatalf("readyz = %d", got)
	}
	shuttingDown.Store(true)
	t.Cleanup(func() { shuttingDown.Store(false) })
	if got := status("/readyz"); got != http.StatusServiceUnavailable {
		t.Fatalf("readyz while shutting down = %d", got)
	}
	if got := status("/healthz"); got != http.StatusOK {
		t.Fatalf("healthz while shutting down = %d", got)
	}

	t.Setenv(constant.EnvKeyShutdownDelaySeconds, "3")
	if got := shutdownDelay(); got.Seconds() != 3 {
		t.Fatalf("shutdown delay = %s", got)
	}
}
