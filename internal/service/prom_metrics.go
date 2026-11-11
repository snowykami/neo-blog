package service

import (
	"crypto/subtle"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/metrics"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// Prometheus 指标（/metrics）：各实例只暴露自己进程内的累计值，多副本时由 Prometheus 按 Pod 分别抓取后再汇总

var (
	httpRequestsTotal = metrics.NewCounterVec("neo_blog_http_requests_total",
		"HTTP requests handled, by method, route template and status code.", "method", "route", "status")
	httpRequestDuration = metrics.NewHistogramVec("neo_blog_http_request_duration_seconds",
		"HTTP request handling time in seconds (event streams excluded), by method, route template and status code.",
		metrics.DefaultBuckets, "method", "route", "status")
	llmCallsTotal = metrics.NewCounterVec("neo_blog_llm_calls_total",
		"LLM calls, by purpose and result (ok / error).", "purpose", "result")
	llmTokensTotal = metrics.NewCounterVec("neo_blog_llm_tokens_total",
		"LLM tokens reported by the provider, by purpose and type (prompt / completion / cached / cache_write).", "purpose", "type")
	llmBudgetRejectionsTotal = metrics.NewCounterVec("neo_blog_llm_budget_rejections_total",
		"LLM calls rejected before calling the model because the site-wide monthly AI budget is used up, by purpose.", "purpose")
)

func init() {
	metrics.RegisterGoRuntime()
	metrics.NewGaugeFunc("neo_blog_http_requests_in_flight", "HTTP requests currently being handled (including event streams).", func() float64 {
		return float64(requestStats.inflight.Load())
	})
	metrics.NewCollectorFunc("neo_blog_db_connections", "Database connection pool connections, by state (in_use / idle).", "gauge", []string{"state"}, func() []metrics.Sample {
		db := repo.GetDB()
		if db == nil {
			return nil
		}
		sqlDB, err := db.DB()
		if err != nil {
			return nil
		}
		stats := sqlDB.Stats()
		return []metrics.Sample{
			{LabelValues: []string{"in_use"}, Value: float64(stats.InUse)},
			{LabelValues: []string{"idle"}, Value: float64(stats.Idle)},
		}
	})
}

// ObserveHTTPRequest 记录一次请求：route 为路由模板（如 /api/v1/post/p/:id，未匹配的为 unmatched），避免按实际路径产生大量序列；
// 事件流（SSE）等长连接只计数，不计入耗时直方图
func ObserveHTTPRequest(method, route string, status int, elapsed time.Duration, longLived bool) {
	if route == "" {
		route = "unmatched"
	}
	code := strconv.Itoa(status)
	httpRequestsTotal.Inc(method, route, code)
	if !longLived {
		httpRequestDuration.Observe(elapsed.Seconds(), method, route, code)
	}
}

// observeLLMCall 记录一次模型调用的指标（用量表之外的实时计数，供 Prometheus 抓取）
func observeLLMCall(purpose string, u llmUsage, err error) {
	result := "ok"
	if err != nil {
		result = "error"
	}
	llmCallsTotal.Inc(purpose, result)
	llmTokensTotal.Add(float64(u.Prompt), purpose, "prompt")
	llmTokensTotal.Add(float64(u.Completion), purpose, "completion")
	llmTokensTotal.Add(float64(u.Cached), purpose, "cached")
	llmTokensTotal.Add(float64(u.CacheWrite), purpose, "cache_write")
}

// MetricsEndpointAuthorized 指标端点的鉴权：未配置 METRICS_TOKEN 时端点关闭；配置后须带 Authorization: Bearer <token>。
// 两种情况都返回 false 时由控制器一律回 404，不暴露端点是否存在
func MetricsEndpointAuthorized(authorization string) bool {
	token := strings.TrimSpace(utils.Env.Get(constant.EnvKeyMetricsToken))
	if token == "" {
		return false
	}
	scheme, given, ok := strings.Cut(strings.TrimSpace(authorization), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(strings.TrimSpace(given)), []byte(token)) == 1
}

// WritePrometheusMetrics 按 text exposition 格式输出本实例的全部指标
func WritePrometheusMetrics(w io.Writer) error {
	return metrics.Default.Write(w)
}
