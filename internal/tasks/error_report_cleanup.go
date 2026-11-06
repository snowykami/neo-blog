package tasks

import (
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/internal/tools"
)

const (
	errorReportCleanupInterval  = 6 * time.Hour
	errorReportRetentionDefault = 30
)

// StartErrorReportCleanup 后台定期清理超过保留期的错误事件，以及之后再没出现过的问题
func StartErrorReportCleanup() {
	runPeriodically("error_report_cleanup", errorReportCleanupInterval, func() {
		days := tools.GetErrorReportRetentionDays()
		if days <= 0 {
			days = errorReportRetentionDefault
		}
		events, issues, err := repo.ErrorReport.DeleteBefore(time.Now().AddDate(0, 0, -days))
		if err != nil {
			logrus.Errorf("error report cleanup failed: %v", err)
		} else if events > 0 || issues > 0 {
			logrus.Infof("error report cleanup: deleted %d events and %d issues older than %d days", events, issues, days)
		}
	})
}
