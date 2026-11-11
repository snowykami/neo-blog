package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
)

// post2026111130 迁移时的文章表快照，只含用到的列（没有 deleted_at：软删除的文章一并回填）
type post2026111130 struct {
	ID      uint
	Content string
	Excerpt string `gorm:"type:text"`
}

func (post2026111130) TableName() string { return "posts" }

// postExcerptBatch 回填时每批读取的文章数（正文是大字段，不一次读出全部）
const postExcerptBatch = 100

// postExcerpt 文章新增纯文本摘要列 excerpt（列表只读它，不再按字节截取正文、截在标签中间），并按已发布正文回填
func postExcerpt() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026111130_post_excerpt",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable(&post2026111130{}) {
				return nil
			}
			if !tx.Migrator().HasColumn(&post2026111130{}, "excerpt") {
				if err := tx.Migrator().AddColumn(&post2026111130{}, "Excerpt"); err != nil {
					return err
				}
			}
			var lastID uint
			for {
				var posts []post2026111130
				if err := tx.Select("id, content").Where("id > ?", lastID).Order("id").Limit(postExcerptBatch).Find(&posts).Error; err != nil {
					return err
				}
				for _, post := range posts {
					if excerpt := model.PostExcerpt(post.Content); excerpt != "" {
						if err := tx.Model(&post2026111130{}).Where("id = ?", post.ID).UpdateColumn("excerpt", excerpt).Error; err != nil {
							return err
						}
					}
				}
				if len(posts) < postExcerptBatch {
					return nil
				}
				lastID = posts[len(posts)-1].ID
			}
		},
	}
}
