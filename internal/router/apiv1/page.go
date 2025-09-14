package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	v1 "github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// page 页面API路由

func registerPageRoutes(group *route.RouterGroup) {
	postGroup := group.Group("/page").Use(middleware.UseAuth(true)).Use(middleware.UseRole(constant.RoleEditor))
	postGroupWithoutAuth := group.Group("/page").Use(middleware.UseAuth(false))
	{
		postGroupWithoutAuth.GET("/p/:id", v1.Page.Get)
		postGroupWithoutAuth.GET("/list", v1.Page.List)

		postGroup.POST("/p", v1.Page.Create)
		postGroup.PUT("/p", v1.Page.Update)
		postGroup.DELETE("/p", v1.Page.Delete)
	}
}
