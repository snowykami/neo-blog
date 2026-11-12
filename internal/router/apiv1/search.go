package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerSearchRoutes(group *route.RouterGroup) {
	searchController := controller.NewSearchController()
	searchGroup := group.Group("/search").Use(middleware.UseAuth(false))
	{
		searchGroup.GET("", searchController.GlobalSearch)
	}
}
