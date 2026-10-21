package tasks

import (
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/repo"
)

const (
	visitLogRetentionKey     = "visit_log_retention_days" // 全局配置：访问记录保留天数
	visitLogRetentionDefault = 90
	visitLogCleanupInterval  = 6 * time.Hour
)

// visitLogRetentionDays 读取保留天数，配置缺失或非法时使用默认值
func visitLogRetentionDays() int {
	switch v := repo.KV.GetKVWithoutErr(visitLogRetentionKey, visitLogRetentionDefault).(type) {
	case int:
		if v > 0 {
			return v
		}
	case float64:
		if v > 0 {
			return int(v)
		}
	}
	return visitLogRetentionDefault
}

// StartVisitLogCleanup 后台定期清理超过保留期的访问记录
func StartVisitLogCleanup() {
	go func() {
		for {
			days := visitLogRetentionDays()
			deleted, err := repo.Visit.DeleteVisitLogsBefore(time.Now().AddDate(0, 0, -days))
			if err != nil {
				logrus.Errorf("visit log cleanup failed: %v", err)
			} else if deleted > 0 {
				logrus.Infof("visit log cleanup: deleted %d logs older than %d days", deleted, days)
			}
			time.Sleep(visitLogCleanupInterval)
		}
	}()
}
