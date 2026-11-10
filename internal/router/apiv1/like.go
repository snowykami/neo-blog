package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerLikeRoutes(group *route.RouterGroup) {
	likeController := controller.NewLikeController()
	likeGroup := group.Group("/like").Use(middleware.UseAuth(true))
	likeGroupWithoutAuth := group.Group("/like", middleware.UseAuth(false))
	{
		likeGroup.PUT("/toggle", likeController.ToggleLike)
		likeGroup.GET("/status", likeController.GetLikeStatus) // 当前用户是否点赞：前台页面对所有人一致，点赞状态由浏览器另取
		likeGroupWithoutAuth.GET("/liked_users", likeController.GetLikedUsers)
		likeGroupWithoutAuth.GET("/user", likeController.ListUserLikes) // 仅本人与管理员可见，由 service 判定
	}
}
