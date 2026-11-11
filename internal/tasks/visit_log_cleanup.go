package tasks

import (
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
)

const (
	visitLogCleanupInterval = 6 * time.Hour
	visitorRetention        = 365 * 24 * time.Hour // 访客汇总在最后一次访问一年后删除
)

// StartVisitLogCleanup 后台定期清理超过保留期的访问记录，以及一年没有再访问的访客汇总
func StartVisitLogCleanup() {
	runPeriodically("visit_log_cleanup", visitLogCleanupInterval, func() {
		// 保留天数走配置注册表（环境变量 > 后台配置 > 默认值，范围 1～3650），与隐私政策页展示的一致
		days := tools.GetVisitLogRetentionDays()
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
