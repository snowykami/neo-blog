package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
)

// registerOAuthRoutes 注册 MCP OAuth 2.1 动态注册、浏览器授权确认、令牌换取与吊销接口
func registerOAuthRoutes(group *route.RouterGroup) {
	oauthGroup := group.Group("/oauth")
	{
		corsPost := middleware.UsePublicCORS("POST", "OPTIONS")
		oauthGroup.POST("/register", corsPost, controller.OAuth.Register)
		oauthGroup.OPTIONS("/register", corsPost)

		oauthGroup.POST("/token", corsPost, controller.OAuth.Token)
		oauthGroup.OPTIONS("/token", corsPost)

		oauthGroup.POST("/revoke", corsPost, controller.OAuth.Revoke)
		oauthGroup.OPTIONS("/revoke", corsPost)

		// 浏览器会话授权确认接口：仅接受登录 Cookie，禁止 CORS 跨域读取，POST 受 UseCookieCSRF 保护
		authGroup := oauthGroup.Group("/authorize")
		authGroup.Use(middleware.UseAuth(true))
		{
			authGroup.GET("/info", controller.OAuth.AuthorizeInfo)
			authGroup.POST("", controller.OAuth.Authorize)
		}
	}
}
