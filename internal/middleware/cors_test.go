package middleware

import (
	"context"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/config"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"github.com/cloudwego/hertz/pkg/route"
)

// newCORS 按给定来源列表起一个只挂 CORS 中间件的引擎（来源在装配时读取，所以每个用例单独建）
func newCORS(t *testing.T, origins string) *route.Engine {
	t.Helper()
	t.Setenv("CORS_ALLOW_ORIGINS", origins)
	engine := route.NewEngine(config.NewOptions(nil))
	engine.Use(UseCORS())
	engine.POST("/api/v1/echo", func(ctx context.Context, c *app.RequestContext) {
		c.String(200, "ok")
	})
	return engine
}

// 跨源直连后端时的 CORS：命中白名单回显来源并允许带凭据，预检直接 204，未配置时不加任何头
func TestCORS(t *testing.T) {
	post := func(engine *route.Engine, origin string) *ut.ResponseRecorder {
		return ut.PerformRequest(engine, "POST", "/api/v1/echo", nil, ut.Header{Key: "Origin", Value: origin})
	}

	// 未配置来源：不加 CORS 头，同源部署的行为不受影响
	empty := newCORS(t, "")
	if w := post(empty, "https://blog.example.com"); w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("disabled cors allow-origin = %q", w.Header().Get("Access-Control-Allow-Origin"))
	}

	// 命中白名单：回显具体来源（带凭据不能用 *），并声明 Vary
	engine := newCORS(t, "https://blog.example.com, https://other.example.com")
	w := post(engine, "https://blog.example.com")
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://blog.example.com" {
		t.Fatalf("allow-origin = %q", got)
	}
	if got := w.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("allow-credentials = %q", got)
	}
	if got := w.Header().Get("Vary"); got != "Origin" {
		t.Fatalf("vary = %q", got)
	}

	// 不在白名单：不加头，交给浏览器拦
	if w := post(engine, "https://evil.example.com"); w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("unknown origin allow-origin = %q", w.Header().Get("Access-Control-Allow-Origin"))
	}

	// 预检：由中间件直接结束，按浏览器声明的请求头回显
	preflight := ut.PerformRequest(engine, "OPTIONS", "/api/v1/echo", nil,
		ut.Header{Key: "Origin", Value: "https://blog.example.com"},
		ut.Header{Key: "Access-Control-Request-Method", Value: "POST"},
		ut.Header{Key: "Access-Control-Request-Headers", Value: "content-type,x-edit-session"})
	if preflight.Code != 204 {
		t.Fatalf("preflight status = %d", preflight.Code)
	}
	if got := preflight.Header().Get("Access-Control-Allow-Methods"); got != corsAllowMethods {
		t.Fatalf("allow-methods = %q", got)
	}
	if got := preflight.Header().Get("Access-Control-Allow-Headers"); got != "content-type,x-edit-session" {
		t.Fatalf("allow-headers = %q", got)
	}
	if got := preflight.Header().Get("Access-Control-Max-Age"); got != corsMaxAgeSeconds {
		t.Fatalf("max-age = %q", got)
	}

	// 带凭据时浏览器不接受通配来源：配成 * 视为未配置
	if w := post(newCORS(t, "*"), "https://blog.example.com"); w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("wildcard origin allow-origin = %q", w.Header().Get("Access-Control-Allow-Origin"))
	}
}
