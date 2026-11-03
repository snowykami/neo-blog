package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
)

// post2026110402 迁移时的文章表快照，只含用到的列
type post2026110402 struct {
	ID          uint
	Content     string
	ContentHash string `gorm:"type:varchar(64)"`
}

func (post2026110402) TableName() string { return "posts" }

// postContentHashBackfill 为升级前已有的文章补全正文哈希（AI 摘要过期判断依赖它）
func postContentHashBackfill() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026110402_post_content_hash_backfill",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable(&post2026110402{}) {
				return nil
			}
			if !tx.Migrator().HasColumn(&post2026110402{}, "ContentHash") {
				if err := tx.Migrator().AddColumn(&post2026110402{}, "ContentHash"); err != nil {
					return err
				}
			}
			var posts []post2026110402
			if err := tx.Select("id, content").Where("content_hash IS NULL OR content_hash = ''").Find(&posts).Error; err != nil {
				return err
			}
			for _, post := range posts {
				if err := tx.Model(&post2026110402{}).Where("id = ?", post.ID).
					UpdateColumn("content_hash", model.HashContent(post.Content)).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
