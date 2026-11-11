package tasks

import (
	"time"

	"github.com/snowykami/neo-blog/internal/service"
)

const llmUsageCleanupInterval = 24 * time.Hour

// StartLLMUsageCleanup 后台每天清理一次超过保留期（13 个月）的模型调用用量记录
func StartLLMUsageCleanup() {
	runPeriodically("llm_usage_cleanup", llmUsageCleanupInterval, service.CleanupLLMUsage)
}
