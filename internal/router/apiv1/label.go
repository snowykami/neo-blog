package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func registerLabelRoutes(group *route.RouterGroup) {
	labelController := controller.NewLabelController()
	labelGroup := group.Group("/label").Use(middleware.UseAuth(true), middleware.UseRole(constant.RoleEditor))
	labelGroupWithoutAuth := group.Group("/label").Use(middleware.UseAuth(false))
	// 标签全站共享：编辑者写文章时可以新建，改名与删除会影响其他作者的文章，只开放给管理员
	labelGroupWithAdmin := group.Group("/label").Use(middleware.UseAuth(true), middleware.UseRole(constant.RoleAdmin))
	{
		labelGroupWithoutAuth.GET("/l/:id", labelController.Get)
		labelGroupWithoutAuth.GET("/list", labelController.List)

		labelGroup.POST("/l", labelController.Create)
		labelGroupWithAdmin.DELETE("/l/:id", labelController.Delete)
		labelGroupWithAdmin.PUT("/l/:id", labelController.Update)
	}
}
