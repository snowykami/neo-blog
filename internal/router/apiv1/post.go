package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	v1 "github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
)

// post 文章API路由

func registerPostRoutes(group *route.RouterGroup) {
	postGroup := group.Group("/post").Use(middleware.UseAuth(true))
	postGroupWithoutAuth := group.Group("/post").Use(middleware.UseAuth(false))
	{
		postGroupWithoutAuth.GET("/p/:id", v1.Post.Get)
		postGroupWithoutAuth.GET("/list", v1.Post.List)
		postGroup.POST("/p", v1.Post.Create)
		postGroup.PUT("/p", v1.Post.Update)
		postGroup.DELETE("/p", v1.Post.Delete)
	}
}
