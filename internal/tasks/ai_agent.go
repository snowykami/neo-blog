package tasks

import (
	"context"
	"time"

	"github.com/snowykami/neo-blog/internal/service"
)

const (
	aiAgentSchedulerInterval = time.Minute      // 时间引擎每分钟唤醒一次
	aiAgentMemoryInterval    = 30 * time.Minute // 记忆整理与过期清理
)

// StartAIAgentScheduler 启动 AI 用户的调度：时间引擎、记忆整理，并订阅其他实例的新任务通知
func StartAIAgentScheduler() {
	agentService := service.NewAIAgentService()
	service.ListenAgentRuns()
	runPeriodically("ai_agent_scheduler", aiAgentSchedulerInterval, func() {
		agentService.RunScheduler(context.Background())
	})
	runPeriodically("ai_agent_memory", aiAgentMemoryInterval, func() {
		agentService.RunMemoryConsolidation(context.Background(), time.Now())
	})
}
