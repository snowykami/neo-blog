package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func registerAdminRoutes(group *route.RouterGroup) {
	// Need Admin Middleware
	adminController := controller.NewAdminController()
	consoleGroup := group.Group("/admin").Use(middleware.UseAuth(true)).Use(middleware.UseRole(constant.RoleAdmin))
	{
		consoleGroup.POST("/oidc/o", adminController.CreateOidc)
		consoleGroup.DELETE("/oidc/o/:id", adminController.DeleteOidc)
		consoleGroup.GET("/oidc/o/:id", adminController.GetOidcByID)
		consoleGroup.GET("/oidc/list", adminController.ListOidc)
		consoleGroup.PUT("/oidc/o/:id", adminController.UpdateOidc)

		consoleGroup.GET("/dashboard", adminController.GetDashboard)
		consoleGroup.GET("/kv/list", adminController.ListKV)
		consoleGroup.POST("/kv", adminController.SetKV)
		consoleGroup.PUT("/kv/:key", adminController.SetKV)
		consoleGroup.DELETE("/kv/:key", adminController.DeleteKV)
		// 全局配置：按配置注册表下发表单结构与当前值，保存时校验
		consoleGroup.GET("/config", adminController.GetConfig)
		consoleGroup.PUT("/config", adminController.SaveConfig)
		// 请求体里带 SMTP 密码，用 POST 且不写进地址；只发信，不改动已保存的配置
		consoleGroup.POST("/config/email/test", adminController.SendTestEmail)
		// 用户区
		consoleGroup.GET("/users", adminController.ListUsers)
		consoleGroup.POST("/users", adminController.CreateUser)
		consoleGroup.GET("/users/:id", adminController.GetUser)
		consoleGroup.PUT("/users/:id", adminController.UpdateUser)
		consoleGroup.PUT("/users/:id/role", adminController.UpdateUserRole)
		consoleGroup.PUT("/users/:id/status", adminController.UpdateUserStatus)
		consoleGroup.PUT("/users/:id/password", adminController.ResetUserPassword)
		consoleGroup.DELETE("/users/:id", adminController.DeleteUser)
		consoleGroup.GET("/comments", adminController.ListComments)
		consoleGroup.GET("/posts", adminController.ListPosts)
		// 文章置顶：首页最多 3 篇，可设到期时间
		consoleGroup.GET("/posts/pinned", adminController.ListPinnedPosts)
		consoleGroup.PUT("/posts/:id/pin", adminController.SetPostPin)
		// 访客记录
		consoleGroup.GET("/visits", adminController.ListVisits)
		consoleGroup.GET("/visits/stats", adminController.GetVisitStats)
		consoleGroup.GET("/visits/insights", adminController.GetVisitInsights)
		consoleGroup.GET("/visits/:id", adminController.GetVisit)
		consoleGroup.GET("/visitors/:id", adminController.GetVisitor)
		// 错误报告：按问题聚合，可标记已解决 / 忽略
		consoleGroup.GET("/errors", adminController.ListErrorIssues)
		consoleGroup.GET("/errors/stats", adminController.GetErrorStats)
		consoleGroup.GET("/errors/:id", adminController.GetErrorIssue)
		consoleGroup.GET("/errors/:id/events", adminController.ListErrorEvents)
		consoleGroup.PUT("/errors/:id/status", adminController.UpdateErrorIssueStatus)
		consoleGroup.DELETE("/errors/:id", adminController.DeleteErrorIssue)
		consoleGroup.GET("/error-events/:id", adminController.GetErrorEvent)
	}
}
