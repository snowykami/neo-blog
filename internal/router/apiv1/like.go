package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	"github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerLikeRoutes(group *route.RouterGroup) {
	likeController := v1.NewLikeController()
	likeGroup := group.Group("/like").Use(middleware.UseAuth(true))
	{
		likeGroup.PUT("/toggle", likeController.ToggleLike)
	}
}
