package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// page 页面API路由

func registerPageRoutes(group *route.RouterGroup) {
	postGroup := group.Group("/page").Use(middleware.UseAuth(true)).Use(middleware.UseRole(constant.RoleEditor))
	postGroupWithoutAuth := group.Group("/page").Use(middleware.UseAuth(false))
	{
		postGroupWithoutAuth.GET("/p/:id", controller.Page.Get)
		postGroupWithoutAuth.GET("/list", controller.Page.List)

		postGroup.POST("/p", controller.Page.Create)
		postGroup.PUT("/p", controller.Page.Update)
		postGroup.DELETE("/p", controller.Page.Delete)
	}
}
