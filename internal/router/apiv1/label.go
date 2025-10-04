package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	v1 "github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func registerLabelRoutes(group *route.RouterGroup) {
	labelController := v1.NewLabelController()
	labelGroup := group.Group("/label").Use(middleware.UseAuth(true), middleware.UseRole(constant.RoleEditor))
	labelGroupWithoutAuth := group.Group("/label").Use(middleware.UseAuth(false))
	{
		labelGroupWithoutAuth.GET("/l/:id", labelController.Get)
		labelGroupWithoutAuth.GET("/list", labelController.List)

		labelGroup.POST("/l", labelController.Create)
		labelGroup.DELETE("/l/:id", labelController.Delete)
		labelGroup.PUT("/l/:id", labelController.Update)
	}
}
