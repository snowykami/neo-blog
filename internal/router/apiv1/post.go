package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	v1 "github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// post 文章API路由

func registerPostRoutes(group *route.RouterGroup) {
	postController := v1.NewPostController()
	postGroup := group.Group("/post").Use(middleware.UseAuth(true)).Use(middleware.UseRole(constant.RoleEditor))
	postGroupWithoutAuth := group.Group("/post").Use(middleware.UseAuth(false))
	{
		postGroupWithoutAuth.GET("/p/:id", postController.Get)
		postGroupWithoutAuth.GET("/list", postController.List)
		postGroup.POST("/p", postController.Create)
		postGroup.PUT("/p/:id", postController.Update)
		postGroup.DELETE("/p/:id", postController.Delete)
	}
}
