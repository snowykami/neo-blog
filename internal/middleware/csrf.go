package middleware

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/internal/tools"
	"github.com/snowykami/neo-blog/pkg/resps"
)

// UseCookieCSRF 对携带登录会话 Cookie 的状态变更请求校验浏览器 Origin / Sec-Fetch-Site，
// 防御跨源与跨子域（SameSite=Lax 下同站兄弟子域仍会附带 Cookie）的 CSRF 请求：
//   - 仅拦截 POST / PUT / DELETE / PATCH
//   - 显式使用 Authorization: Bearer 令牌的请求（如 API Token / MCP）不受 Cookie CSRF 影响，直接放行
//   - 未携带 Origin、Sec-Fetch-Site 与 Referer 的非浏览器请求（服务端转发、CLI、单测）原样放行
func UseCookieCSRF() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		if !isStateChangingMethod(string(c.Method())) {
			c.Next(ctx)
			return
		}
		if len(c.Cookie("token")) == 0 && len(c.Cookie("refresh_token")) == 0 {
			c.Next(ctx)
			return
		}
		authHeader := strings.TrimSpace(string(c.GetHeader("Authorization")))
		if len(authHeader) >= 7 && strings.EqualFold(authHeader[:7], "Bearer ") {
			c.Next(ctx)
			return
		}

		allowed := allowedCSRFHosts(c)
		if origin := strings.TrimSpace(string(c.GetHeader("Origin"))); origin != "" {
			if !originMatchesAllowed(origin, allowed) {
				resps.Forbidden(c, "csrf_origin_mismatch")
				c.Abort()
				return
			}
			c.Next(ctx)
			return
		}

		if fetchSite := strings.ToLower(strings.TrimSpace(string(c.GetHeader("Sec-Fetch-Site")))); fetchSite != "" {
			if fetchSite != "same-origin" && fetchSite != "none" {
				resps.Forbidden(c, "csrf_origin_mismatch")
				c.Abort()
				return
			}
			c.Next(ctx)
			return
		}

		if referer := strings.TrimSpace(string(c.GetHeader("Referer"))); referer != "" {
			if !originMatchesAllowed(referer, allowed) {
				resps.Forbidden(c, "csrf_origin_mismatch")
				c.Abort()
				return
			}
		}
		c.Next(ctx)
	}
}

func isStateChangingMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch:
		return true
	default:
		return false
	}
}

func allowedCSRFHosts(c *app.RequestContext) map[string]struct{} {
	hosts := make(map[string]struct{}, 3)
	if fwd := firstForwardedHost(string(c.GetHeader("X-Forwarded-Host"))); fwd != "" {
		hosts[fwd] = struct{}{}
	} else {
		if reqHost := strings.ToLower(strings.TrimSpace(string(c.Host()))); reqHost != "" {
			hosts[reqHost] = struct{}{}
		}
		if hdrHost := strings.ToLower(strings.TrimSpace(string(c.GetHeader("Host")))); hdrHost != "" {
			hosts[hdrHost] = struct{}{}
		}
	}
	if base := strings.TrimSpace(tools.GetBaseUrl()); base != "" {
		if u, err := url.Parse(base); err == nil && u.Host != "" {
			hosts[strings.ToLower(strings.TrimSpace(u.Host))] = struct{}{}
		}
	}
	return hosts
}

func firstForwardedHost(raw string) string {
	if raw == "" {
		return ""
	}
	if idx := strings.IndexByte(raw, ','); idx >= 0 {
		raw = raw[:idx]
	}
	return strings.ToLower(strings.TrimSpace(raw))
}

func originMatchesAllowed(rawURL string, allowed map[string]struct{}) bool {
	if strings.EqualFold(rawURL, "null") {
		return false
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return false
	}
	_, ok := allowed[strings.ToLower(strings.TrimSpace(u.Host))]
	return ok
}
