package apiv1

import (
	"github.com/cloudwego/hertz/pkg/common/adaptor"
	"github.com/cloudwego/hertz/pkg/route"
	controller "github.com/snowykami/neo-blog/internal/controller"
	"github.com/snowykami/neo-blog/internal/mcpserver"
	"github.com/snowykami/neo-blog/internal/middleware"
	"github.com/snowykami/neo-blog/pkg/constant"
)

// registerAIAgentRoutes AI 用户：管理接口（管理员）、Runner 接口（共享密钥）、AI 用户的 MCP（租约令牌）
func registerAIAgentRoutes(group *route.RouterGroup) {
	cc := controller.NewAIAgentController()
	admin := group.Group("/admin").Use(middleware.UseAuth(true), middleware.UseRole(constant.RoleAdmin))
	{
		admin.GET("/ai-agents", cc.List)
		admin.GET("/ai-agents/stats", cc.Stats)
		admin.POST("/ai-agents", cc.Create)
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

	// Runner 接口：只接受 AGENT_RUNNER_TOKEN，未配置时整体关闭；前端 rewrites 不转发这些路径
	runner := group.Group("/agent-runner").Use(middleware.UseAgentRunner())
	{
		runner.POST("/lease", cc.Lease)
		runner.POST("/runs/:id/heartbeat", cc.Heartbeat)
		runner.POST("/runs/:id/complete", cc.Complete)
		runner.POST("/llm/chat/completions", cc.LLMGateway)
	}

	// AI 用户的 MCP：只接受租约令牌，以该 AI 用户的身份执行
	handler := adaptor.HertzHandler(mcpserver.NewAgentHandler())
	agentMCP := group.Group("/agent-mcp").Use(middleware.UseAgentLease())
	{
		agentMCP.POST("", handler)
		agentMCP.GET("", handler)
		agentMCP.DELETE("", handler)
	}
}
