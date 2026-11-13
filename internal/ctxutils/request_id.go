package ctxutils

import (
	"context"
	"crypto/rand"
	"encoding/hex"

	"github.com/sirupsen/logrus"
)

// RequestIDHeader 请求 ID 的请求头 / 响应头：前端转发时生成或透传，后端沿用并写回响应，日志与错误报告据此串起同一个请求
const RequestIDHeader = "X-Request-ID"

// TraceIDHeader 链路追踪 ID 响应头：当请求带上游 W3C traceparent 或启用 OTel 时返回
const TraceIDHeader = "X-Trace-ID"

type requestIDKey struct{}
type traceIDKey struct{}

// WithRequestID 挂载请求 ID
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, id)
}

// RequestID 当前请求的 ID；不在请求中（后台任务等）时为空
func RequestID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

// WithTraceID 挂载链路追踪 TraceID
func WithTraceID(ctx context.Context, traceID string) context.Context {
	return context.WithValue(ctx, traceIDKey{}, traceID)
}

// TraceID 当前上下文关联的链路追踪 TraceID；无追踪上下文时为空
func TraceID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	id, _ := ctx.Value(traceIDKey{}).(string)
	return id
}

// ValidRequestID 外部传入的请求 ID 只接受 8~64 位的字母、数字与 - _ . :，
// 其余（过长、含空白或控制字符等可能伪造日志行的内容）一律丢弃并重新生成
func ValidRequestID(id string) bool {
	if len(id) < 8 || len(id) > 64 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == '.' || c == ':') {
			return false
		}
	}
	return true
}

// NewRequestID 生成新的请求 ID（32 位十六进制）
func NewRequestID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// RequestIDLogHook logrus 钩子：用 logrus.WithContext(ctx) 写的日志自动带上 request_id 字段
type RequestIDLogHook struct{}

func (RequestIDLogHook) Levels() []logrus.Level { return logrus.AllLevels }

func (RequestIDLogHook) Fire(entry *logrus.Entry) error {
	if entry.Context == nil {
		return nil
	}
	if _, exists := entry.Data["request_id"]; !exists {
		if id := RequestID(entry.Context); id != "" {
			entry.Data["request_id"] = id
		}
	}
	if _, exists := entry.Data["trace_id"]; !exists {
		if traceID := TraceID(entry.Context); traceID != "" {
			entry.Data["trace_id"] = traceID
		}
	}
	return nil
}

// Log 带当前请求 ID 的日志入口（等价于 logrus.WithContext(ctx)，需已注册 RequestIDLogHook）
func Log(ctx context.Context) *logrus.Entry {
	return logrus.WithContext(ctx)
}
