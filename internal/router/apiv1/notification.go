package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerNotificationRoutes(group *route.RouterGroup) {
	notificationController := controller.NewNotificationController()
	// 通知只属于收件人本人：全部接口都要求登录，越权 id 由 service 返回 404
	notificationGroup := group.Group("/notifications").Use(middleware.UseAuth(true))
	{
		notificationGroup.GET("", notificationController.ListNotifications)
		notificationGroup.GET("/unread-count", notificationController.GetUnreadCount)
		notificationGroup.POST("/read-all", notificationController.MarkAllRead)
		notificationGroup.POST("/:id/read", notificationController.MarkRead)
		// 展开聚合行：点赞组里具体是谁
		notificationGroup.GET("/:id/members", notificationController.ListGroupMembers)
	}
	// 偏好：邮件里的链接带免登录凭据，因此挂在不强制登录的组上，由中间件补受限身份；
	// 凭据只能作用于这三条接口（改不了昵称、密码、邮箱）
	prefsGroup := group.Group("/notifications/preferences", middleware.UseAuth(false), middleware.UseNotifyPrefsToken())
	{
		prefsGroup.GET("", notificationController.GetPreferences)
		prefsGroup.PUT("", notificationController.UpdatePreferences)
		prefsGroup.POST("/unsubscribe-all", notificationController.UnsubscribeAll)
	}
}
