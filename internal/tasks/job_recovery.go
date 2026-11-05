package tasks

import (
	"time"

	"github.com/snowykami/neo-blog/internal/service"
)

const jobRecoveryInterval = time.Minute

// StartJobRecovery 定期接手执行中途中断的后台任务（执行的实例退出，如滚动更新、崩溃）：AI 摘要与存储迁移。
// 判断依据是共享状态中的任务令牌已过期而任务仍未完成；多副本时每轮只有一个实例执行，接手时再用 SetNX 抢占，不会重复执行
func StartJobRecovery() {
	runPeriodically("ai_summary_resume", jobRecoveryInterval, service.ResumePendingAISummaries)
	runPeriodically("storage_migration_resume", jobRecoveryInterval, service.ResumeStorageMigration)
}
