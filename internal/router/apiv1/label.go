package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	v1 "github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerLabelRoutes(group *route.RouterGroup) {
	labelGroup := group.Group("/label").Use(middleware.UseAuth(true))
	labelGroupWithoutAuth := group.Group("/label").Use(middleware.UseAuth(false))
	{
		labelGroupWithoutAuth.GET("/l/:id", v1.Label.Get)
		labelGroupWithoutAuth.GET("/list", v1.Label.List)

		labelGroup.POST("/l", v1.Label.Create)
		labelGroup.DELETE("/l/:id", v1.Label.Delete)
		labelGroup.PUT("/l/:id", v1.Label.Update)
	}
}
