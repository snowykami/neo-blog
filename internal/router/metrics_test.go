package router

import (
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/cloudwego/hertz/pkg/common/ut"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// /metrics：未配置 METRICS_TOKEN 时关闭（404）；配置后不带或带错令牌也是 404，带对令牌返回 Prometheus 文本格式，
// 含按路由模板分组的请求计数与耗时直方图、Go 运行时与模型调用指标；每个响应都带请求 ID
func TestMetricsEndpoint(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBURL, "")
	t.Setenv(constant.EnvKeyDBPath, filepath.Join(t.TempDir(), "test.db"))
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init database: %v", err)
	}
	get := func(path string, headers ...ut.Header) *ut.ResponseRecorder {
		return ut.PerformRequest(h.Engine, http.MethodGet, path, nil, headers...)
	}

	t.Setenv(constant.EnvKeyMetricsToken, "")
	if w := get("/metrics"); w.Code != http.StatusNotFound {
		t.Fatalf("metrics without configured token = %d", w.Code)
	}
	t.Setenv(constant.EnvKeyMetricsToken, "scrape-token-123")
	for _, headers := range [][]ut.Header{nil, {{Key: "Authorization", Value: "Bearer wrong"}}, {{Key: "Authorization", Value: "scrape-token-123"}}} {
		if w := get("/metrics", headers...); w.Code != http.StatusNotFound {
			t.Fatalf("metrics with %v = %d, want 404", headers, w.Code)
		}
	}

	// 先产生一些请求：带路径参数的路由按模板计数
	if w := get("/api/v1/label/l/123"); w.Header().Get("X-Request-ID") == "" {
		t.Fatalf("response should carry X-Request-ID")
	}
	get("/api/v1/no-such-route")

	w := get("/metrics", ut.Header{Key: "Authorization", Value: "Bearer scrape-token-123"})
	if w.Code != http.StatusOK || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/plain; version=0.0.4") {
		t.Fatalf("metrics = %d %q", w.Code, w.Header().Get("Content-Type"))
	}
	body := w.Body.String()
	for _, want := range []string{
		"# TYPE neo_blog_http_requests_total counter",
		`neo_blog_http_requests_total{method="GET",route="/api/v1/label/l/:id",status="`,
		`route="unmatched",status="404"`,
		"# TYPE neo_blog_http_request_duration_seconds histogram",
		`neo_blog_http_request_duration_seconds_bucket{method="GET",route="/api/v1/label/l/:id",`,
		"# TYPE neo_blog_llm_calls_total counter",
		"# TYPE neo_blog_llm_tokens_total counter",
		"go_goroutines ",
		"go_memstats_alloc_bytes ",
		"neo_blog_http_requests_in_flight ",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics missing %q:\n%s", want, body)
		}
	}
	// 探针与指标抓取本身不计入
	if strings.Contains(body, `route="/healthz"`) || strings.Contains(body, `route="/metrics"`) {
		t.Fatalf("probes and scrapes should not be counted:\n%s", body)
	}
	// 实际路径不出现在标签里（避免高基数）
	if strings.Contains(body, "/api/v1/label/l/123") || strings.Contains(body, "no-such-route") {
		t.Fatalf("raw paths must not be used as labels:\n%s", body)
	}
}
