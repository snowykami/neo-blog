package migrations

import (
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// notification2026111101 迁移时的通知表快照：新增的最近活动时间与邮件领取时间
type notification2026111101 struct {
	ID             uint
	UserID         uint      `gorm:"index:idx_notification_user_activity,priority:1"`
	ActivityAt     time.Time `gorm:"index:idx_notification_user_activity,priority:2"`
	EmailClaimedAt *time.Time
}

func (notification2026111101) TableName() string { return "notifications" }

// notificationActivityClaim 通知列表改按最近活动时间排序，邮件投递记录领取时间以便收回中断的批次：
//   - 补 activity_at 列并回填：普通行取 created_at；折叠行取 updated_at（以前只有它随新回复刷新，
//     虽然已读也会刷新它，但比 created_at 更接近最后一次回复）
//   - 补 email_claimed_at 列：已经卡在 sending 的行回填为 updated_at，升级后超时即被 worker 收回
//   - 补 (user_id, activity_at) 组合索引
func notificationActivityClaim() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026111101_notification_activity_claim",
		Migrate: func(tx *gorm.DB) error {
			m := tx.Migrator()
			if !m.HasTable(&notification2026111101{}) {
				// 通知表还不存在：由 AutoMigrate 按最新模型建表
				return nil
			}
			for _, field := range []string{"ActivityAt", "EmailClaimedAt"} {
				if !m.HasColumn(&notification2026111101{}, field) {
					if err := m.AddColumn(&notification2026111101{}, field); err != nil {
						return err
					}
				}
			}
			if err := tx.Exec("UPDATE notifications SET activity_at = created_at WHERE activity_at IS NULL AND (aggregate_count IS NULL OR aggregate_count = 0)").Error; err != nil {
				return err
			}
			if err := tx.Exec("UPDATE notifications SET activity_at = COALESCE(updated_at, created_at) WHERE activity_at IS NULL").Error; err != nil {
				return err
			}
			if err := tx.Exec("UPDATE notifications SET email_claimed_at = COALESCE(updated_at, created_at) WHERE email_state = ? AND email_claimed_at IS NULL", "sending").Error; err != nil {
				return err
			}
			if !m.HasIndex(&notification2026111101{}, "idx_notification_user_activity") {
				return m.CreateIndex(&notification2026111101{}, "idx_notification_user_activity")
			}
			return nil
		},
	}
}
