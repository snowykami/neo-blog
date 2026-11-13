package telemetry_test

import (
	"context"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/config"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"github.com/cloudwego/hertz/pkg/route"
	"github.com/snowykami/neo-blog/internal/ctxutils"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/telemetry"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestInitNoopWhenEndpointEmpty(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	shutdown, err := telemetry.Init(context.Background(), "neo-blog-test")
	if err != nil {
		t.Fatalf("unexpected init error: %v", err)
	}
	defer func() { _ = shutdown(context.Background()) }()

	if telemetry.Enabled() {
		t.Fatalf("expected telemetry.Enabled() == false when OTEL_EXPORTER_OTLP_ENDPOINT is empty")
	}
}

func TestTraceContextExtractionInNoopMode(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	shutdown, err := telemetry.Init(context.Background(), "neo-blog-test")
	if err != nil {
		t.Fatalf("unexpected init error: %v", err)
	}
	defer func() { _ = shutdown(context.Background()) }()

	engine := route.NewEngine(config.NewOptions(nil))
	engine.Use(middleware.UseRequestLog())
	var gotTraceID string
	engine.GET("/api/v1/ping", func(ctx context.Context, c *app.RequestContext) {
		gotTraceID = ctxutils.TraceID(ctx)
		c.String(200, "pong")
	})

	upstreamTraceID := "4bf92f3577b34da6a3ce929d0e0e4736"
	w := ut.PerformRequest(
		engine,
		"GET",
		"/api/v1/ping",
		nil,
		ut.Header{Key: "traceparent", Value: "00-" + upstreamTraceID + "-00f067aa0ba902b7-01"},
	)
	resp := w.Result()
	if resp.StatusCode() != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode())
	}
	if gotTraceID != upstreamTraceID {
		t.Fatalf("expected extracted trace_id %q, got %q", upstreamTraceID, gotTraceID)
	}
	if hdr := resp.Header.Get(ctxutils.TraceIDHeader); hdr != upstreamTraceID {
		t.Fatalf("expected response header %s=%q, got %q", ctxutils.TraceIDHeader, upstreamTraceID, hdr)
	}
}

func TestRequestAndGormSpansWhenEnabled(t *testing.T) {
	t.Setenv(constant.EnvKeyDBDriver, "sqlite")
	t.Setenv(constant.EnvKeyDBPath, t.TempDir()+"/otel.db")
	if err := repo.InitDatabase(); err != nil {
		t.Fatalf("init db: %v", err)
	}

	exporter := tracetest.NewInMemoryExporter()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	restore := telemetry.SetTracerProviderForTest(tp, true)
	defer func() {
		restore()
		_ = tp.Shutdown(context.Background())
	}()

	engine := route.NewEngine(config.NewOptions(nil))
	engine.Use(middleware.UseRequestLog())
	engine.GET("/healthz", func(ctx context.Context, c *app.RequestContext) {
		c.String(200, "ok")
	})
	engine.GET("/api/v1/users/count", func(ctx context.Context, c *app.RequestContext) {
		var count int64
		_ = repo.DB(ctx).Model(&model.User{}).Count(&count).Error
		c.String(200, "ok")
	})

	// /healthz 不应产生 Span
	ut.PerformRequest(engine, "GET", "/healthz", nil)
	if len(exporter.GetSpans()) != 0 {
		t.Fatalf("expected 0 spans for /healthz, got %d", len(exporter.GetSpans()))
	}

	upstreamTraceID := "11112222333344445555666677778888"
	w := ut.PerformRequest(
		engine,
		"GET",
		"/api/v1/users/count",
		nil,
		ut.Header{Key: "traceparent", Value: "00-" + upstreamTraceID + "-0123456789abcdef-01"},
	)
	if w.Result().StatusCode() != 200 {
		t.Fatalf("expected 200, got %d", w.Result().StatusCode())
	}

	spans := exporter.GetSpans()
	if len(spans) < 2 {
		t.Fatalf("expected at least 2 spans (server + gorm), got %d", len(spans))
	}
	var hasServer, hasGorm bool
	for _, s := range spans {
		if s.SpanContext.TraceID().String() != upstreamTraceID {
			t.Fatalf("span %q traceID=%s, want %s", s.Name, s.SpanContext.TraceID().String(), upstreamTraceID)
		}
		if s.Name == "GET /api/v1/users/count" {
			hasServer = true
		}
		if s.Name == "SELECT users" {
			hasGorm = true
		}
	}
	if !hasServer || !hasGorm {
		t.Fatalf("expected both server and gorm spans, got hasServer=%v hasGorm=%v spans=%+v", hasServer, hasGorm, spans)
	}
}
