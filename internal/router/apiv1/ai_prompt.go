package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// registerAIPromptRoutes 编辑器 AI 快捷指令：编辑者可用；平台指令的增删改在服务层限制为管理员
// 语言习惯只读写当前用户自己的
func registerAIPromptRoutes(group *route.RouterGroup) {
	aiPromptGroup := group.Group("/ai-prompt").Use(middleware.UseAuth(true)).Use(middleware.UseRole(constant.RoleEditor))
	{
		aiPromptGroup.GET("/list", controller.AIPrompt.List)
		aiPromptGroup.POST("/p", controller.AIPrompt.Create)
		aiPromptGroup.PUT("/p/:id", controller.AIPrompt.Update)
		aiPromptGroup.DELETE("/p/:id", controller.AIPrompt.Delete)
		aiPromptGroup.GET("/habit", controller.AIPrompt.GetWritingHabit)
		aiPromptGroup.PUT("/habit", controller.AIPrompt.UpdateWritingHabit)
	}
}
