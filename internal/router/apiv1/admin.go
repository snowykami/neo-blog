package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	v1 "github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerAdminRoutes(group *route.RouterGroup) {
	// Need Admin Middleware
	adminController := v1.NewAdminController()
	consoleGroup := group.Group("/admin").Use(middleware.UseAuth(true))
	{
		consoleGroup.POST("/oidc/o", adminController.CreateOidc)
		consoleGroup.DELETE("/oidc/o/:id", adminController.DeleteOidc)
		consoleGroup.GET("/oidc/o/:id", adminController.GetOidcByID)
		consoleGroup.GET("/oidc/list", adminController.ListOidc)
		consoleGroup.PUT("/oidc/o/:id", adminController.UpdateOidc)
	}
}
