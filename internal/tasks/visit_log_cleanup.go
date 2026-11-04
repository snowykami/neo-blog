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
	visitorRetention         = 365 * 24 * time.Hour // 访客汇总在最后一次访问一年后删除
)

// visitLogRetentionDays 读取保留天数，配置缺失或非法时使用默认值
func visitLogRetentionDays() int {
	if days := repo.KV.GetIntWithoutErr(visitLogRetentionKey, visitLogRetentionDefault); days > 0 {
		return days
	}
	return visitLogRetentionDefault
}

// StartVisitLogCleanup 后台定期清理超过保留期的访问记录，以及一年没有再访问的访客汇总
func StartVisitLogCleanup() {
	runPeriodically("visit_log_cleanup", visitLogCleanupInterval, func() {
		days := visitLogRetentionDays()
		deleted, err := repo.Visit.DeleteVisitLogsBefore(time.Now().AddDate(0, 0, -days))
		if err != nil {
			logrus.Errorf("visit log cleanup failed: %v", err)
		} else if deleted > 0 {
			logrus.Infof("visit log cleanup: deleted %d logs older than %d days", deleted, days)
		}
		if _, err := repo.Visit.DeleteVisitEventsBefore(time.Now().AddDate(0, 0, -days)); err != nil {
			logrus.Errorf("visit event cleanup failed: %v", err)
		}
		if deleted, err := repo.Visit.DeleteInactiveVisitors(time.Now().Add(-visitorRetention)); err != nil {
			logrus.Errorf("visitor cleanup failed: %v", err)
		} else if deleted > 0 {
			logrus.Infof("visitor cleanup: deleted %d inactive visitors", deleted)
		}
	})
}
