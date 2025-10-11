package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// post 文章API路由

func registerPostRoutes(group *route.RouterGroup) {
	postController := controller.NewPostController()
	postGroupWithAuth := group.Group("/post").Use(middleware.UseAuth(true)).Use(middleware.UseRole(constant.RoleEditor))
	postGroupPublic := group.Group("/post").Use(middleware.UseAuth(false))
	{
		postGroupPublic.GET("/p/:slug_or_id", postController.Get)        // 获取文章
		postGroupPublic.GET("/list", postController.List)                // 获取文章列表
		postGroupPublic.GET("/categories", postController.GetCategories) // 获取文章分类列表
		postGroupPublic.GET("/random", postController.GetRandom)         // 获取随机文章ID
		// 需要鉴权且有编辑权限
		postGroupWithAuth.POST("/p", postController.Create)               // 创建文章
		postGroupWithAuth.PUT("/p/:id", postController.Update)            // 更新文章
		postGroupWithAuth.DELETE("/p/:id", postController.Delete)         // 删除文章
		postGroupWithAuth.POST("/c", postController.CreateCategory)       // 创建文章分类
		postGroupWithAuth.PUT("/c/:id", postController.UpdateCategory)    // 更新文章分类
		postGroupWithAuth.DELETE("/c/:id", postController.DeleteCategory) // 删除文章分类
	}
}
