package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	v1 "github.com/snowykami/neo-blog/internal/controller/v1"
	"github.com/snowykami/neo-blog/internal/middleware"
)

func registerCommentRoutes(group *route.RouterGroup) {
	commentController := v1.NewCommentController()
	commentGroup := group.Group("/comment").Use(middleware.UseAuth(true))
	commentGroupWithoutAuth := group.Group("/comment").Use(middleware.UseAuth(false))
	{
		commentGroup.POST("/c", commentController.CreateComment)
		commentGroup.PUT("/c/:id", commentController.UpdateComment)
		commentGroup.DELETE("/c/:id", commentController.DeleteComment)
		commentGroup.PUT("/c/:id/react", commentController.ReactComment) // 暂时先不写
		commentGroupWithoutAuth.GET("/c/:id", commentController.GetComment)
		commentGroupWithoutAuth.GET("/list", commentController.GetCommentList)
	}
}
