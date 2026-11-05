package migrations

import (
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// post2026110504 迁移时的文章表快照：旧的置顶级别 top 与新的置顶时间、到期时间
type post2026110504 struct {
	ID          uint
	Top         uint
	PinnedAt    *time.Time
	PinnedUntil *time.Time
	DeletedAt   gorm.DeletedAt
}

func (post2026110504) TableName() string { return "posts" }

// postPinning 置顶从数字级别改为置顶时间（越晚越靠前）加可选的到期时间，首页最多 3 篇：
// 原来置顶级别最高的 3 篇按级别从高到低转为置顶（级别越高置顶时间越晚），其余取消置顶；
// 然后删掉 top 列以及包含它的索引（列表组合索引改为不含 top，启动时按新定义重建）
func postPinning() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026110504_post_pinning",
		Migrate: func(tx *gorm.DB) error {
			m := tx.Migrator()
			if !m.HasTable(&post2026110504{}) {
				return nil
			}
			for _, field := range []string{"PinnedAt", "PinnedUntil"} {
				if !m.HasColumn(&post2026110504{}, field) {
					if err := m.AddColumn(&post2026110504{}, field); err != nil {
						return err
					}
				}
			}
			if !m.HasColumn(&post2026110504{}, "Top") {
				return nil
			}
			var pinned []post2026110504
			if err := tx.Select("id", "top").Where("top > 0").Order("top DESC").Order("id DESC").Limit(3).Find(&pinned).Error; err != nil {
				return err
			}
			now := time.Now()
			for i, post := range pinned {
				pinnedAt := now.Add(-time.Duration(i) * time.Second)
				if err := tx.Model(&post2026110504{}).Where("id = ?", post.ID).UpdateColumn("pinned_at", pinnedAt).Error; err != nil {
					return err
				}
			}
			// SQLite 删列前要先删掉引用它的索引；Postgres 删列时会一并删除，这里统一先删
			for _, index := range []string{"idx_posts_top", "idx_posts_list_created", "idx_posts_list_heat"} {
				if m.HasIndex(&post2026110504{}, index) {
					if err := m.DropIndex(&post2026110504{}, index); err != nil {
						return err
					}
				}
			}
			return m.DropColumn(&post2026110504{}, "Top")
		},
	}
}
