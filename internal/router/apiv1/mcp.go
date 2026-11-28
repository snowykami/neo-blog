package apiv1

import (
	"github.com/cloudwego/hertz/pkg/common/adaptor"
	"github.com/cloudwego/hertz/pkg/route"
	"github.com/snowykami/neo-blog/internal/mcpserver"
	"github.com/snowykami/neo-blog/internal/middleware"
)

// registerMCPRoutes 远程 MCP 服务（Streamable HTTP），同时接受个人 API Token（nbp_...）与 OAuth 2.1 Access Token（nbo_...）
func registerMCPRoutes(group *route.RouterGroup) {
	handler := adaptor.HertzHandler(mcpserver.NewHandler())
	cors := middleware.UsePublicCORS("POST", "GET", "DELETE", "OPTIONS")
	authed := middleware.UseAPIToken()
	mcpGroup := group.Group("/mcp")
	mcpGroup.Use(cors)
	{
		mcpGroup.OPTIONS("", cors)
		mcpGroup.POST("", authed, handler)
		mcpGroup.GET("", authed, handler)    // 无状态模式下返回 405，告知客户端不支持服务端推送流
		mcpGroup.DELETE("", authed, handler) // 同上
	}
}
