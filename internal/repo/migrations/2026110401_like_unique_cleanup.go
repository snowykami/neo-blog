package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// likeUniqueCleanup 点赞表加唯一索引 idx_like_target_user 前，清理软删除记录和并发产生的重复点赞，并按实际记录修正计数
func likeUniqueCleanup() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026110401_like_unique_cleanup",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable("likes") || tx.Migrator().HasIndex("likes", "idx_like_target_user") {
				return nil
			}
			if err := tx.Exec("DELETE FROM likes WHERE deleted_at IS NOT NULL").Error; err != nil {
				return err
			}
			if err := tx.Exec("DELETE FROM likes WHERE id NOT IN (SELECT MIN(id) FROM likes GROUP BY target_type, target_id, user_id)").Error; err != nil {
				return err
			}
			if err := tx.Exec("UPDATE posts SET like_count = (SELECT COUNT(*) FROM likes WHERE likes.target_type = ? AND likes.target_id = posts.id)", "post").Error; err != nil {
				return err
			}
			return tx.Exec("UPDATE comments SET like_count = (SELECT COUNT(*) FROM likes WHERE likes.target_type = ? AND likes.target_id = comments.id)", "comment").Error
		},
	}
}
