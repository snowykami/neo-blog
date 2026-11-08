package tasks

import (
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/config"
	"github.com/snowykami/neo-blog/internal/repo"
)

// 通知清理：按保留期硬删通知与互动事件，并把长期没搭上车的附带行置为 skipped，
// 否则长期没有重要邮件的收件人会让这些行永远挂在 attached（见 docs/notification-spec.md 6.4）
const notificationCleanupInterval = 6 * time.Hour

// StartNotificationCleanup 定期清理过期通知
func StartNotificationCleanup() {
	runPeriodically("notification_cleanup", notificationCleanupInterval, func() {
		now := time.Now()
		days := config.Int("notification_retention_days")
		notifications, events, err := repo.Notification.DeleteBefore(now.AddDate(0, 0, -days))
		if err != nil {
			logrus.Errorf("notification cleanup failed: %v", err)
		} else if notifications > 0 || events > 0 {
			logrus.Infof("notification cleanup: deleted %d notifications and %d events older than %d days", notifications, events, days)
		}
		// 超过搭车窗口的附带行不再等下一封邮件
		attachHours := config.Int("notification_email_attach_hours")
		if skipped, err := repo.Notification.SkipStaleAttachedEmails(now.Add(-time.Duration(attachHours) * time.Hour)); err != nil {
			logrus.Errorf("notification attached cleanup failed: %v", err)
		} else if skipped > 0 {
			logrus.Infof("notification cleanup: skipped %d stale attached rows", skipped)
		}
	})
}
