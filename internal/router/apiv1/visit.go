package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
)

// visit 访客记录上报（公开，登录状态可选）
func registerVisitRoutes(group *route.RouterGroup) {
	visitGroup := group.Group("/visit").Use(middleware.UseAuth(false))
	{
		visitGroup.POST("", controller.Visit.Report)
	}
}
