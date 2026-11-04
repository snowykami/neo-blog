package tasks

import (
	"context"
	"time"

	"github.com/snowykami/neo-blog/internal/agentrunner"
	"github.com/snowykami/neo-blog/internal/service"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
)

const (
	aiAgentSchedulerInterval = time.Minute      // 时间引擎每分钟唤醒一次
	aiAgentMemoryInterval    = 30 * time.Minute // 记忆整理与过期清理
	aiAgentDefaultWorkers    = 2                // 每个实例默认同时执行的任务数
)

// StartAIAgentScheduler 启动 AI 用户：时间引擎与记忆整理（多副本时每轮只有一个实例执行）、
// 订阅其他实例的新任务通知，并启动本实例执行任务的 worker（AI_AGENT_WORKERS，默认 2）
func StartAIAgentScheduler() {
	agentService := service.NewAIAgentService()
	service.ListenAgentRuns()
	runPeriodically("ai_agent_scheduler", aiAgentSchedulerInterval, func() {
		agentService.RunScheduler(context.Background())
	})
	runPeriodically("ai_agent_memory", aiAgentMemoryInterval, func() {
		agentService.RunMemoryConsolidation(context.Background(), time.Now())
	})
	agentrunner.Start(utils.Env.GetAsInt(constant.EnvKeyAIAgentWorkers, aiAgentDefaultWorkers))
}
