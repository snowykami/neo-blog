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
		// 偏好：邮件里的免登录链接（带 token）在 P1 接入，这里先用登录身份
		notificationGroup.GET("/preferences", notificationController.GetPreferences)
		notificationGroup.PUT("/preferences", notificationController.UpdatePreferences)
		notificationGroup.POST("/preferences/unsubscribe-all", notificationController.UnsubscribeAll)
	}
}
