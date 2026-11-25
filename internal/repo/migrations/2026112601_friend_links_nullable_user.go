package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

type friendLink2026112601 struct {
	UserID *uint `gorm:"index"`
}

func (friendLink2026112601) TableName() string { return "friend_links" }

// friendLinksNullableUser 将已建表的 friend_links.user_id 放宽为可空（NULL 表示站长托管），
// 并把外键约束升级为 ON DELETE SET NULL，避免站长后台添加无归属友链时触发 Postgres 外键约束报错。
func friendLinksNullableUser() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026112601_friend_links_nullable_user",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable("friend_links") || !tx.Migrator().HasColumn("friend_links", "user_id") {
				return nil
			}
			if tx.Dialector.Name() == "postgres" {
				if err := tx.Exec("ALTER TABLE friend_links DROP CONSTRAINT IF EXISTS fk_friend_links_user").Error; err != nil {
					return err
				}
				if err := tx.Exec("ALTER TABLE friend_links ALTER COLUMN user_id DROP NOT NULL").Error; err != nil {
					return err
				}
				if err := tx.Exec("UPDATE friend_links SET user_id = NULL WHERE user_id = 0 OR (user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users))").Error; err != nil {
					return err
				}
				if err := tx.Exec("ALTER TABLE friend_links ADD CONSTRAINT fk_friend_links_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL").Error; err != nil {
					return err
				}
				return nil
			}
			if err := tx.Migrator().AlterColumn(&friendLink2026112601{}, "UserID"); err != nil {
				return err
			}
			return tx.Exec("UPDATE friend_links SET user_id = NULL WHERE user_id = 0").Error
		},
	}
}
