package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	v1 "github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func registerMiscRoutes(group *route.RouterGroup) {
	miscController := v1.NewMiscController()
	miscGroupAdmin := group.Group("/misc").Use(middleware.UseAuth(true)).Use(middleware.UseRole(constant.RoleAdmin))
	miscGroupWithoutAuth := group.Group("/misc").Use(middleware.UseAuth(false))
	{
		miscGroupWithoutAuth.GET("/site-info", miscController.GetSiteInfo)
		miscGroupAdmin.PUT("/site-info", miscController.SetSiteInfo)
	}
}
