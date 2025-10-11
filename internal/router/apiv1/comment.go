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
		commentGroup.PUT("/c/:id/react", commentController.ReactComment)
		commentGroupWithoutAuth.GET("/c/:id", commentController.GetComment)
		commentGroupWithoutAuth.GET("/list", commentController.GetCommentList)
	}
}
