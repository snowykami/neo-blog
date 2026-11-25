package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

func registerFriendRoutes(group *route.RouterGroup) {
	friendController := controller.NewFriendController()

	// 公开友链读取（支持外部站点 CORS，且可选携带 friends:read API Token 读取非公开分组）
	publicGroup := group.Group("/friends")
	{
		publicGroup.OPTIONS("", friendController.OptionsPublic)
		publicGroup.GET("", middleware.UseAuth(false, constant.ScopeFriendsRead), friendController.ListPublic)
		publicGroup.OPTIONS("/avatar/:id/:hash", friendController.OptionsPublic)
		publicGroup.HEAD("/avatar/:id/:hash", middleware.UseAuth(false, constant.ScopeFriendsRead), friendController.GetAvatar)
		publicGroup.GET("/avatar/:id/:hash", middleware.UseAuth(false, constant.ScopeFriendsRead), friendController.GetAvatar)
	}

	// 登录用户的自助申请、AI 自动填写与名下友链管理
	userGroup := group.Group("/friends").Use(middleware.UseAuth(true))
	{
		userGroup.GET("/mine", friendController.ListMine)
		userGroup.POST("/autofill", friendController.Autofill)
		userGroup.POST("", friendController.CreateMine)
		userGroup.PUT("/:id", friendController.UpdateMine)
		userGroup.DELETE("/:id", friendController.DeleteMine)
	}

	// 管理员后台全量管理与审核（支持后台会话及 friends:write API Token）
	adminGroup := group.Group("/admin/friends").Use(middleware.UseAuth(true, constant.ScopeFriendsWrite)).Use(middleware.UseRole(constant.RoleAdmin))
	{
		adminGroup.GET("/groups", friendController.AdminListGroups)
		adminGroup.POST("/groups", friendController.AdminCreateGroup)
		adminGroup.PUT("/groups/reorder", friendController.AdminReorderGroups)
		adminGroup.PUT("/groups/:id", friendController.AdminUpdateGroup)
		adminGroup.DELETE("/groups/:id", friendController.AdminDeleteGroup)

		adminGroup.GET("/links", friendController.AdminListLinks)
		adminGroup.POST("/links", friendController.AdminCreateLink)
		adminGroup.PUT("/links/:id", friendController.AdminUpdateLink)
		adminGroup.POST("/links/:id/review", friendController.AdminReviewLink)
		adminGroup.PUT("/links/:id/transfer", friendController.AdminTransferLink)
		adminGroup.DELETE("/links/:id", friendController.AdminDeleteLink)
		adminGroup.POST("/links/:id/probe", friendController.AdminProbeLink)
		adminGroup.POST("/probe", friendController.AdminProbeAll)
	}
}
