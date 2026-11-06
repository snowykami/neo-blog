package middleware

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/middlewares/server/recovery"
	"github.com/cloudwego/hertz/pkg/common/config"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"github.com/cloudwego/hertz/pkg/route"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"github.com/snowykami/neo-blog/pkg/resps"
	"github.com/snowykami/neo-blog/pkg/sharedstate"
)

// panic 返回统一的 500 并带调用栈记为后端错误（不再按 5xx 重复记一次）；业务返回的 5xx 记下错误码与原始错误；就绪检查的 503 不记
func TestBackendErrorReport(t *testing.T) {
	sharedstate.UseMemory()
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	engine := route.NewEngine(config.NewOptions(nil))
	engine.Use(recovery.Recovery(recovery.WithRecoveryHandler(RecoveryHandler)), UseErrorReport())
	engine.GET("/panic", func(ctx context.Context, c *app.RequestContext) { panic("boom") })
	engine.GET("/fail", func(ctx context.Context, c *app.RequestContext) {
		resps.Error(c, errs.Internal("failed_to_get_target", errors.New("database is locked")))
	})
	engine.GET("/readyz", func(ctx context.Context, c *app.RequestContext) { resps.Custom(c, 503, "shutting_down", nil) })

	if w := ut.PerformRequest(engine, "GET", "/panic", nil); w.Code != 500 {
		t.Fatalf("panic status = %d", w.Code)
	}
	ut.PerformRequest(engine, "GET", "/fail", nil)
	ut.PerformRequest(engine, "GET", "/readyz", nil)

	// 记录在后台协程中进行
	var issues []model.ErrorIssue
	for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		issues = nil
		repo.GetDB().Order("id").Find(&issues)
		if len(issues) >= 2 {
			break
		}
	}
	if len(issues) != 2 {
		t.Fatalf("issues = %+v", issues)
	}
	byLevel := map[string]model.ErrorIssue{}
	for _, issue := range issues {
		byLevel[issue.Level] = issue
	}
	if p := byLevel["fatal"]; p.Title != "panic: boom" || p.Source != constant.ErrorSourceBackend || p.Culprit != "GET /panic · internal/middleware/error_report_test.go:34 TestBackendErrorReport.func1" {
		t.Fatalf("panic issue: %+v", p)
	}
	if f := byLevel["error"]; f.Title != "failed_to_get_target: database is locked" || f.Culprit != "GET /fail" {
		t.Fatalf("5xx issue: %+v", f)
	}
}
