package middleware

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/config"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"github.com/cloudwego/hertz/pkg/route"
	"github.com/sirupsen/logrus"
	"github.com/sirupsen/logrus/hooks/test"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// accessLogEntries 只取访问日志（message 为 access）
func accessLogEntries(hook *test.Hook) []*logrus.Entry {
	var entries []*logrus.Entry
	for _, e := range hook.AllEntries() {
		if e.Message == "access" {
			entries = append(entries, e)
		}
	}
	return entries
}

// 请求 ID：合法的外部请求 ID 沿用，不合法或没有时重新生成；写进响应头与处理函数的 ctx。
// 访问日志：每个请求一行，查询参数只记键名；探针不记，高频轮询与 SSE 降为 debug，5xx 至少为 warn
func TestRequestLog(t *testing.T) {
	t.Setenv(constant.EnvKeyAccessLog, "true")
	t.Setenv(constant.EnvKeyAccessLogLevel, "info")
	hook := test.NewGlobal()
	defer hook.Reset()
	prevLevel := logrus.GetLevel()
	logrus.SetLevel(logrus.InfoLevel)
	defer logrus.SetLevel(prevLevel)
	logrus.AddHook(ctxutils.RequestIDLogHook{})
	// 测试结束后去掉加上的钩子，避免影响其他用例
	defer logrus.StandardLogger().ReplaceHooks(make(logrus.LevelHooks))

	engine := route.NewEngine(config.NewOptions(nil))
	engine.Use(UseRequestLog())
	var handlerRequestID string
	engine.GET("/api/v1/post/p/:id", func(ctx context.Context, c *app.RequestContext) {
		handlerRequestID = ctxutils.RequestID(ctx)
		logrus.WithContext(ctx).Info("inside handler")
		c.String(http.StatusOK, "ok")
	})
	engine.GET("/healthz", func(ctx context.Context, c *app.RequestContext) { c.String(http.StatusOK, "ok") })
	engine.GET("/api/v1/misc/cache-tags", func(ctx context.Context, c *app.RequestContext) { c.String(http.StatusOK, "{}") })
	engine.GET("/api/v1/broken", func(ctx context.Context, c *app.RequestContext) { c.String(http.StatusInternalServerError, "x") })
	engine.GET("/api/v1/stream", func(ctx context.Context, c *app.RequestContext) {
		c.Data(http.StatusOK, "text/event-stream; charset=utf-8", []byte("data: 1\n\n"))
	})

	// 合法的外部请求 ID 沿用
	w := ut.PerformRequest(engine, http.MethodGet, "/api/v1/post/p/12?token=secret-value&page=2&page=3", nil,
		ut.Header{Key: "X-Request-ID", Value: "abcdef0123456789"})
	if got := w.Header().Get("X-Request-ID"); got != "abcdef0123456789" || handlerRequestID != "abcdef0123456789" {
		t.Fatalf("request id: header %q, ctx %q", got, handlerRequestID)
	}
	entries := accessLogEntries(hook)
	if len(entries) != 1 {
		t.Fatalf("access log entries = %d", len(entries))
	}
	e := entries[0]
	if e.Level != logrus.InfoLevel || e.Data["method"] != "GET" || e.Data["path"] != "/api/v1/post/p/12" || e.Data["route"] != "/api/v1/post/p/:id" ||
		e.Data["status"] != http.StatusOK || e.Data["request_id"] != "abcdef0123456789" || e.Data["query_keys"] != "page,token" {
		t.Fatalf("access log fields = %v", e.Data)
	}
	for _, entry := range hook.AllEntries() {
		line, _ := entry.String()
		if strings.Contains(line, "secret-value") {
			t.Fatalf("query values must not be logged: %s", line)
		}
		if entry.Message == "inside handler" && entry.Data["request_id"] != "abcdef0123456789" {
			t.Fatalf("logs written with the request ctx should carry request_id: %v", entry.Data)
		}
	}

	// 不合法（含空白、过短）或没有时重新生成
	for _, given := range []string{"", "short", "bad id with spaces\nlevel=error"} {
		hook.Reset()
		headers := []ut.Header{}
		if given != "" {
			headers = append(headers, ut.Header{Key: "X-Request-ID", Value: given})
		}
		w := ut.PerformRequest(engine, http.MethodGet, "/api/v1/post/p/1", nil, headers...)
		got := w.Header().Get("X-Request-ID")
		if got == given || !ctxutils.ValidRequestID(got) || len(got) != 32 {
			t.Fatalf("invalid request id %q should be replaced, got %q", given, got)
		}
	}

	// 探针不记
	hook.Reset()
	ut.PerformRequest(engine, http.MethodGet, "/healthz", nil)
	if n := len(accessLogEntries(hook)); n != 0 {
		t.Fatalf("healthz should not be logged, got %d entries", n)
	}
	// 高频轮询与 SSE 降为 debug（info 级别下不输出）
	ut.PerformRequest(engine, http.MethodGet, "/api/v1/misc/cache-tags", nil)
	ut.PerformRequest(engine, http.MethodGet, "/api/v1/stream", nil)
	if n := len(accessLogEntries(hook)); n != 0 {
		t.Fatalf("quiet paths should be logged at debug, got %d entries at info", n)
	}
	logrus.SetLevel(logrus.DebugLevel)
	ut.PerformRequest(engine, http.MethodGet, "/api/v1/stream", nil)
	if entries := accessLogEntries(hook); len(entries) != 1 || entries[0].Level != logrus.DebugLevel {
		t.Fatalf("event stream should be logged at debug: %v", entries)
	}
	logrus.SetLevel(logrus.InfoLevel)
	// 5xx 至少为 warn
	hook.Reset()
	ut.PerformRequest(engine, http.MethodGet, "/api/v1/broken", nil)
	if entries := accessLogEntries(hook); len(entries) != 1 || entries[0].Level != logrus.WarnLevel {
		t.Fatalf("5xx should be logged at warn: %v", entries)
	}
}

// ACCESS_LOG=false 时不输出访问日志，但仍生成请求 ID
func TestRequestLogDisabled(t *testing.T) {
	t.Setenv(constant.EnvKeyAccessLog, "false")
	hook := test.NewGlobal()
	defer logrus.StandardLogger().ReplaceHooks(make(logrus.LevelHooks))
	engine := route.NewEngine(config.NewOptions(nil))
	engine.Use(UseRequestLog())
	engine.GET("/x", func(ctx context.Context, c *app.RequestContext) { c.String(http.StatusOK, "ok") })
	w := ut.PerformRequest(engine, http.MethodGet, "/x", nil)
	if w.Header().Get("X-Request-ID") == "" {
		t.Fatal("request id should still be set when access log is disabled")
	}
	if n := len(accessLogEntries(hook)); n != 0 {
		t.Fatalf("access log disabled but got %d entries", n)
	}
}
