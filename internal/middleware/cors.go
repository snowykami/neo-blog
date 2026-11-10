package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
)

// CORS 允许的来源（逗号分隔），只在浏览器跨源直连后端时才需要：
// 前端配置了 NEXT_PUBLIC_BACKEND_URL=https://api.example.com 时，把 https://blog.example.com 列进来即可。
// 不设置＝不启用（同源部署不需要），此时不给任何响应加 CORS 头，行为与之前一致。
//
// 登录态走 cookie，所以始终带 Access-Control-Allow-Credentials: true —— 带凭据的请求要求
// Allow-Origin 是具体来源，不能是 "*"（配成 "*" 会被忽略，这里按请求来源回显白名单里的那一项）。
const (
	corsMaxAgeSeconds = "600"
	// 浏览器没声明 Access-Control-Request-Headers 时的默认值（列出前端会带的请求头）
	corsDefaultAllowHeaders = "Authorization, Content-Type, X-Email, X-VerifyCode, X-Edit-Session"
	corsAllowMethods        = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
)

// UseCORS 处理跨源请求：命中白名单时回显来源并允许携带凭据；预检请求直接返回 204。
// 注册在其他中间件之前：预检不进业务链路，实际请求也先带上响应头再交给后续中间件。
func UseCORS() app.HandlerFunc {
	allowed := parseAllowedOrigins(utils.Env.Get(constant.EnvKeyCorsAllowOrigins))
	return func(ctx context.Context, c *app.RequestContext) {
		origin := string(c.Request.Header.Peek("Origin"))
		if len(allowed) == 0 || origin == "" || !allowed[strings.ToLower(strings.TrimSuffix(origin, "/"))] {
			c.Next(ctx)
			return
		}

		responseHeader := &c.Response.Header
		responseHeader.Set("Access-Control-Allow-Origin", origin)
		responseHeader.Set("Access-Control-Allow-Credentials", "true")
		// 同一个地址对不同来源会给出不同的头，必须声明 Vary，避免被浏览器/代理缓存串味
		responseHeader.Add("Vary", "Origin")

		// 预检：浏览器不带凭据与业务头，直接 204 结束，不进入路由
		if string(c.Method()) == http.MethodOptions && len(c.Request.Header.Peek("Access-Control-Request-Method")) > 0 {
			responseHeader.Set("Access-Control-Allow-Methods", corsAllowMethods)
			if requested := string(c.Request.Header.Peek("Access-Control-Request-Headers")); requested != "" {
				// 按浏览器请求的头回显，前端加自定义头时不必改后端配置
				responseHeader.Set("Access-Control-Allow-Headers", requested)
			} else {
				responseHeader.Set("Access-Control-Allow-Headers", corsDefaultAllowHeaders)
			}
			responseHeader.Set("Access-Control-Max-Age", corsMaxAgeSeconds)
			c.SetStatusCode(http.StatusNoContent)
			c.Abort()
			return
		}

		c.Next(ctx)
	}
}

// parseAllowedOrigins 逗号分隔的来源列表 → 小写集合；"*" 会被丢弃（带凭据时浏览器不接受通配来源）
func parseAllowedOrigins(raw string) map[string]bool {
	origins := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		origin := strings.ToLower(strings.TrimSpace(part))
		if origin == "" || origin == "*" {
			continue
		}
		origins[origin] = true
	}
	return origins
}
