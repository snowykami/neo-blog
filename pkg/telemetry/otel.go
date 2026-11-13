package telemetry

import (
	"context"
	"os"
	"strings"
	"sync/atomic"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"
)

var enabled atomic.Bool

func init() {
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
}

// Init 初始化 OpenTelemetry TracerProvider。
// 未配置 OTEL_EXPORTER_OTLP_ENDPOINT 时保持 Noop 模式（零网络开销），仅启用 W3C TraceContext 请求头提取。
func Init(ctx context.Context, defaultServiceName string) (func(context.Context) error, error) {
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	endpoint := strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"))
	if endpoint == "" {
		enabled.Store(false)
		otel.SetTracerProvider(noop.NewTracerProvider())
		return func(context.Context) error { return nil }, nil
	}

	exp, err := otlptracehttp.New(ctx)
	if err != nil {
		enabled.Store(false)
		return func(context.Context) error { return nil }, err
	}

	svcName := strings.TrimSpace(os.Getenv("OTEL_SERVICE_NAME"))
	if svcName == "" {
		svcName = defaultServiceName
	}

	res, err := resource.Merge(
		resource.Default(),
		resource.NewSchemaless(attribute.String("service.name", svcName)),
	)
	if err != nil {
		res = resource.NewSchemaless(attribute.String("service.name", svcName))
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	enabled.Store(true)

	return func(shutdownCtx context.Context) error {
		enabled.Store(false)
		return tp.Shutdown(shutdownCtx)
	}, nil
}

// Enabled 返回当前是否已启用 OTLP 链路追踪导出
func Enabled() bool {
	return enabled.Load()
}

// Tracer 获取指定模块名的 Tracer
func Tracer(name string) trace.Tracer {
	return otel.Tracer(name)
}

// SetTracerProviderForTest 仅供单元测试注入自定义 TracerProvider 并恢复状态
func SetTracerProviderForTest(tp trace.TracerProvider, isEnabled bool) func() {
	prevTP := otel.GetTracerProvider()
	prevEnabled := enabled.Load()
	otel.SetTracerProvider(tp)
	enabled.Store(isEnabled)
	return func() {
		otel.SetTracerProvider(prevTP)
		enabled.Store(prevEnabled)
	}
}
