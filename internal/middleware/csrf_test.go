package middleware

import (
	"context"
	"net/http"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/common/config"
	"github.com/cloudwego/hertz/pkg/common/ut"
	"github.com/cloudwego/hertz/pkg/route"
	"github.com/snowykami/neo-blog/pkg/resps"
)

func TestUseCookieCSRF(t *testing.T) {
	r := route.NewEngine(config.NewOptions(nil))
	r.Use(UseCookieCSRF())
	r.POST("/api/v1/post", func(ctx context.Context, c *app.RequestContext) {
		resps.Ok(c, "ok", nil)
	})
	r.GET("/api/v1/post", func(ctx context.Context, c *app.RequestContext) {
		resps.Ok(c, "ok", nil)
	})

	// 1. 跨站携带 token Cookie 的写请求拦截为 403
	w := ut.PerformRequest(r, "POST", "/api/v1/post", nil,
		ut.Header{Key: "Host", Value: "blog.example.com"},
		ut.Header{Key: "Cookie", Value: "token=abc"},
		ut.Header{Key: "Origin", Value: "https://evil.example.org"},
	)
	if w.Code != http.StatusForbidden {
		t.Fatalf("cross-origin cookie POST: got %d, want 403", w.Code)
	}

	// 2. Sec-Fetch-Site: cross-site 的 Cookie 写请求拦截为 403
	w = ut.PerformRequest(r, "POST", "/api/v1/post", nil,
		ut.Header{Key: "Host", Value: "blog.example.com"},
		ut.Header{Key: "Cookie", Value: "refresh_token=def"},
		ut.Header{Key: "Sec-Fetch-Site", Value: "cross-site"},
	)
	if w.Code != http.StatusForbidden {
		t.Fatalf("Sec-Fetch-Site cross-site cookie POST: got %d, want 403", w.Code)
	}

	// 3. 同源 Cookie 写请求正常放行
	w = ut.PerformRequest(r, "POST", "/api/v1/post", nil,
		ut.Header{Key: "Host", Value: "blog.example.com"},
		ut.Header{Key: "Cookie", Value: "token=abc"},
		ut.Header{Key: "Origin", Value: "https://blog.example.com"},
	)
	if w.Code != http.StatusOK {
		t.Fatalf("same-origin cookie POST: got %d, want 200", w.Code)
	}

	// 4. 携带 Authorization: Bearer 的 API / MCP 请求不受跨站 Origin 影响
	w = ut.PerformRequest(r, "POST", "/api/v1/post", nil,
		ut.Header{Key: "Host", Value: "blog.example.com"},
		ut.Header{Key: "Authorization", Value: "Bearer nb_pat_123"},
		ut.Header{Key: "Cookie", Value: "token=abc"},
		ut.Header{Key: "Origin", Value: "https://other.example.org"},
	)
	if w.Code != http.StatusOK {
		t.Fatalf("Bearer POST: got %d, want 200", w.Code)
	}

	// 5. CLI / 服务端内部无 Origin / Sec-Fetch-Site / Referer 的请求正常放行
	w = ut.PerformRequest(r, "POST", "/api/v1/post", nil,
		ut.Header{Key: "Host", Value: "blog.example.com"},
		ut.Header{Key: "Cookie", Value: "token=abc"},
	)
	if w.Code != http.StatusOK {
		t.Fatalf("CLI cookie POST without browser headers: got %d, want 200", w.Code)
	}

	// 6. GET 请求即使携带跨站 Origin 也不拦截（预览等公开读取不受影响）
	w = ut.PerformRequest(r, "GET", "/api/v1/post", nil,
		ut.Header{Key: "Host", Value: "blog.example.com"},
		ut.Header{Key: "Cookie", Value: "token=abc"},
		ut.Header{Key: "Origin", Value: "https://preview-domain.example.net"},
	)
	if w.Code != http.StatusOK {
		t.Fatalf("cross-origin GET: got %d, want 200", w.Code)
	}
}
