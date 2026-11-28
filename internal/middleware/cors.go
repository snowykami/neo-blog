package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
)

// UsePublicCORS 为不依赖浏览器 Cookie 的公开协议端点（/.well-known/oauth-*、/api/v1/oauth/{register,token,revoke}、/api/v1/mcp）
// 提供跨域预检与响应头暴露支持，使 MCP Inspector 等浏览器端客户端可读取 WWW-Authenticate 与 Mcp-Session-Id。
// 注意：严禁用于依赖会话 Cookie 的端点，且绝不设置 Access-Control-Allow-Credentials。
func UsePublicCORS(allowedMethods ...string) app.HandlerFunc {
	methods := "GET, POST, OPTIONS"
	if len(allowedMethods) > 0 {
		methods = strings.Join(allowedMethods, ", ")
	}
	return func(ctx context.Context, c *app.RequestContext) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", methods)
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID")
		c.Header("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id")
		c.Header("Access-Control-Max-Age", "86400")
		if string(c.Method()) == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next(ctx)
	}
}
