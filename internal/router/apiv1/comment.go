package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerCommentRoutes(group *route.RouterGroup) {
	commentController := controller.NewCommentController()
	commentGroup := group.Group("/comment").Use(middleware.UseAuth(true))
	commentGroupWithoutAuth := group.Group("/comment").Use(middleware.UseAuth(false))
	{
		commentGroup.POST("/c", commentController.CreateComment)
		commentGroup.PUT("/c/:id", commentController.UpdateComment)
		commentGroup.DELETE("/c/:id", commentController.DeleteComment)
		commentGroup.POST("/batch-delete", commentController.BatchDeleteComments)
		commentGroupWithoutAuth.GET("/c/:id", commentController.GetComment)
		commentGroupWithoutAuth.POST("/c/:id/translate", commentController.TranslateComment) // 访客也可翻译自己看得到的评论，按用户或 IP 限流
		commentGroupWithoutAuth.GET("/list", commentController.GetCommentList)
		commentGroupWithoutAuth.GET("/user", commentController.ListUserComments)
	}
}
