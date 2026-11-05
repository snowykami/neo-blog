package apiv1

import (
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// registerAIAgentRoutes AI 用户的管理接口（管理员）；任务由各实例上的 worker 在进程内执行，不对外开放接口
func registerAIAgentRoutes(group *route.RouterGroup) {
	cc := controller.NewAIAgentController()
	admin := group.Group("/admin").Use(middleware.UseAuth(true), middleware.UseRole(constant.RoleAdmin))
	{
		admin.GET("/ai-agents", cc.List)
		admin.GET("/ai-agents/stats", cc.Stats)
		admin.POST("/ai-agents", cc.Create)
		admin.GET("/ai-agents/export", cc.Export)
		admin.POST("/ai-agents/import", cc.Import)
		admin.POST("/ai-agents/batch", cc.Batch)
		admin.GET("/ai-agents/:id", cc.Get)
		admin.PUT("/ai-agents/:id", cc.Update)
		admin.POST("/ai-agents/:id/pause", cc.Pause())
		admin.POST("/ai-agents/:id/resume", cc.Resume())
		admin.DELETE("/ai-agents/:id", cc.Delete)
		admin.POST("/ai-agents/:id/dry-run", cc.DryRun)
		admin.GET("/ai-agents/:id/memories", cc.ListMemories)
		admin.GET("/ai-agents/:id/relations", cc.ListRelations)
		admin.PUT("/ai-agent-memories/:id", cc.UpdateMemory)
		admin.DELETE("/ai-agent-memories/:id", cc.DeleteMemory)
		admin.DELETE("/ai-agent-relations/:id", cc.DeleteRelation)
		admin.GET("/ai-agent-runs", cc.ListRuns)
		admin.GET("/ai-agent-runs/:id", cc.GetRun)
		admin.POST("/ai-agent-runs/:id/revert", cc.RevertRun)
		admin.GET("/ai-agent-groups", cc.ListGroups)
		admin.POST("/ai-agent-groups/generate", cc.GenerateGroup)
		admin.GET("/ai-agent-groups/:id", cc.GetGroup)
		admin.PUT("/ai-agent-groups/:id/status", cc.SetGroupStatus)
		admin.POST("/users/:id/ai", cc.ConvertUser)
	}
}
