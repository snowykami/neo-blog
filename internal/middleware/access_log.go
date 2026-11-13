package middleware

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/telemetry"
	"github.com/snowykami/neo-blog/pkg/utils"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// 访问日志：每个请求一行结构化日志（方法、路径、路由模板、查询参数的键名、状态码、耗时、请求 ID、客户端 IP），
// 查询参数只记键名不记值（可能含令牌、验证码、搜索词等）；同时记录 Prometheus 的 HTTP 指标

const (
	accessLogMaxPath      = 512
	accessLogMaxQueryKeys = 20
	accessLogMaxKeyLen    = 32
)

// accessLogSkipPaths 不记访问日志也不计入指标的路径：探针与指标抓取每几秒一次，记下来只会刷屏
var accessLogSkipPaths = map[string]bool{"/healthz": true, "/readyz": true, "/metrics": true}

// accessLogQuietPaths 高频轮询的路径：访问日志降为 debug（前端每个实例每隔几秒拉一次缓存标签版本号）
var accessLogQuietPaths = map[string]bool{"/api/v1/misc/cache-tags": true}

// accessLogConfig 访问日志的开关与级别（ACCESS_LOG / ACCESS_LOG_LEVEL）
type accessLogConfig struct {
	enabled bool
	level   logrus.Level
}

func loadAccessLogConfig() accessLogConfig {
	level, err := logrus.ParseLevel(strings.TrimSpace(utils.Env.Get(constant.EnvKeyAccessLogLevel, "info")))
	if err != nil || level > logrus.DebugLevel {
		level = logrus.InfoLevel
	}
	return accessLogConfig{enabled: utils.Env.GetAsBool(constant.EnvKeyAccessLog, true), level: level}
}

// hertzHeaderCarrier 适配 Hertz 请求头供 OpenTelemetry TextMapPropagator 提取 W3C TraceContext
type hertzHeaderCarrier struct {
	header *protocol.RequestHeader
}

func (c hertzHeaderCarrier) Get(key string) string {
	return c.header.Get(key)
}

func (c hertzHeaderCarrier) Set(key, value string) {
	c.header.Set(key, value)
}

func (c hertzHeaderCarrier) Keys() []string {
	var keys []string
	c.header.VisitAll(func(key, _ []byte) {
		keys = append(keys, string(key))
	})
	return keys
}

// UseRequestLog 请求 ID、链路追踪、访问日志与 HTTP 指标；需注册为第一个中间件（在 recovery 之外），
// 处理函数 panic 时也能拿到 recovery 写出的 500，且 recovery 与错误报告拿到的 ctx 已带请求 ID
func UseRequestLog() app.HandlerFunc {
	cfg := loadAccessLogConfig()
	return func(ctx context.Context, c *app.RequestContext) {
		path := string(c.Path())
		if accessLogSkipPaths[path] {
			c.Next(ctx)
			return
		}
		// 前端转发时带来的请求 ID 格式合法就沿用（同一个请求在前端与后端的日志里能对上），否则重新生成
		requestID := string(c.GetHeader(ctxutils.RequestIDHeader))
		if !ctxutils.ValidRequestID(requestID) {
			requestID = ctxutils.NewRequestID()
		}
		c.Set("request_id", requestID)
		c.Response.Header.Set(ctxutils.RequestIDHeader, requestID)
		ctx = ctxutils.WithRequestID(ctx, requestID)

		// 提取上游 W3C traceparent（即使未开启导出也可串起前后端 trace_id）
		ctx = otel.GetTextMapPropagator().Extract(ctx, hertzHeaderCarrier{header: &c.Request.Header})
		method := string(c.Method())
		var span trace.Span
		if telemetry.Enabled() {
			ctx, span = telemetry.Tracer("hertz").Start(ctx, method, trace.WithSpanKind(trace.SpanKindServer))
			defer span.End()
		}
		var traceID string
		if sc := trace.SpanFromContext(ctx).SpanContext(); sc.HasTraceID() {
			traceID = sc.TraceID().String()
			ctx = ctxutils.WithTraceID(ctx, traceID)
			c.Response.Header.Set(ctxutils.TraceIDHeader, traceID)
		}

		start := time.Now()
		c.Next(ctx)
		elapsed := time.Since(start)

		status := c.Response.StatusCode()
		// 个别处理函数会重置响应（含响应头），补回请求 ID 与 Trace ID；流式响应的头已发出，这里设置不产生影响
		if len(c.Response.Header.Peek(ctxutils.RequestIDHeader)) == 0 {
			c.Response.Header.Set(ctxutils.RequestIDHeader, requestID)
		}
		if traceID != "" && len(c.Response.Header.Peek(ctxutils.TraceIDHeader)) == 0 {
			c.Response.Header.Set(ctxutils.TraceIDHeader, traceID)
		}
		route := c.FullPath()
		if span != nil {
			if route != "" {
				span.SetName(method + " " + route)
			}
			span.SetAttributes(
				attribute.String("http.request.method", method),
				attribute.String("url.path", utils.Truncate(path, accessLogMaxPath)),
				attribute.String("http.route", route),
				attribute.Int("http.response.status_code", status),
				attribute.String("request_id", requestID),
			)
			if status >= http.StatusInternalServerError {
				span.SetStatus(codes.Error, http.StatusText(status))
			}
		}
		longLived := isEventStream(c)
		service.ObserveHTTPRequest(method, route, status, elapsed, longLived)
		if !cfg.enabled {
			return
		}
		level := cfg.level
		if longLived || accessLogQuietPaths[path] {
			level = logrus.DebugLevel
		}
		if status >= http.StatusInternalServerError && level > logrus.WarnLevel {
			level = logrus.WarnLevel
		}
		if !logrus.IsLevelEnabled(level) {
			return
		}
		fields := logrus.Fields{
			"method":      method,
			"path":        utils.Truncate(path, accessLogMaxPath),
			"route":       route,
			"status":      status,
			"duration_ms": float64(elapsed.Microseconds()) / 1000,
			"request_id":  requestID,
			"ip":          c.ClientIP(),
		}
		if traceID != "" {
			fields["trace_id"] = traceID
		}
		if keys := queryKeys(c); keys != "" {
			fields["query_keys"] = keys
		}
		logrus.WithFields(fields).Log(level, "access")
	}
}

// isEventStream 事件流（SSE）等长连接：耗时是连接时长而不是处理时间，不计入耗时直方图，访问日志降为 debug
func isEventStream(c *app.RequestContext) bool {
	return strings.Contains(string(c.Response.Header.ContentType()), "text/event-stream") ||
		strings.Contains(string(c.GetHeader("Accept")), "text/event-stream")
}

// queryKeys 查询参数的键名（去重、排序、截断），不含值
func queryKeys(c *app.RequestContext) string {
	args := c.Request.URI().QueryArgs()
	if args.Len() == 0 {
		return ""
	}
	seen := map[string]bool{}
	args.VisitAll(func(key, _ []byte) {
		if len(seen) < accessLogMaxQueryKeys {
			seen[utils.Truncate(string(key), accessLogMaxKeyLen)] = true
		}
	})
	keys := make([]string, 0, len(seen))
	for key := range seen {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return strings.Join(keys, ",")
}
