package apiv1

import (
	"github.com/cloudwego/hertz/pkg/common/adaptor"
	"github.com/cloudwego/hertz/pkg/route"
	"github.com/snowykami/neo-blog/internal/mcpserver"
	"github.com/snowykami/neo-blog/internal/middleware"
)

// registerMCPRoutes 远程 MCP 服务（Streamable HTTP），只接受个人 API Token
func registerMCPRoutes(group *route.RouterGroup) {
	handler := adaptor.HertzHandler(mcpserver.NewHandler())
	mcpGroup := group.Group("/mcp").Use(middleware.UseAPIToken())
	{
		mcpGroup.POST("", handler)
		mcpGroup.GET("", handler)    // 无状态模式下返回 405，告知客户端不支持服务端推送流
		mcpGroup.DELETE("", handler) // 同上
	}
}
