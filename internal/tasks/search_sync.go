package tasks

import (
	"time"

	"github.com/snowykami/neo-blog/internal/service"
)

const searchReconcileInterval = 15 * time.Minute

// StartSearchSync 启动时确保公开搜索索引结构就绪（空索引自动后台回填），并定期对账修复偶发网络抖动产生的差异
func StartSearchSync() {
	go runSafely("search_init", service.EnsureSearchReady)
	runPeriodically("search_reconcile", searchReconcileInterval, service.ReconcileSearchIndexes)
}
