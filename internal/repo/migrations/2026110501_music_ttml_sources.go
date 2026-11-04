package migrations

import (
	"strings"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
)

// kv2026110501 迁移时的配置表快照：值存为 {"value": 实际值}
type kv2026110501 struct {
	Key   string `gorm:"primaryKey;type:varchar(64)"`
	Value model.JSONMap
}

func (kv2026110501) TableName() string { return "kvs" }

// musicTTMLSources 自定义 TTML 歌词源由单个地址（music_ttml_url_template）改为可命名的列表（music_ttml_sources）：
// 旧地址非空时转为列表中一个没有名称的源（已有新配置时不覆盖），然后删除旧配置键
func musicTTMLSources() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026110501_music_ttml_sources",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable(&kv2026110501{}) {
				return nil
			}
			var old []kv2026110501
			if err := tx.Where("key = ?", "music_ttml_url_template").Find(&old).Error; err != nil || len(old) == 0 {
				return err
			}
			address, _ := old[0].Value["value"].(string)
			if address = strings.TrimSpace(address); address != "" {
				var count int64
				if err := tx.Model(&kv2026110501{}).Where("key = ?", "music_ttml_sources").Count(&count).Error; err != nil {
					return err
				}
				if count == 0 {
					sources := []map[string]any{{"name": "", "url": address}}
					if err := tx.Create(&kv2026110501{Key: "music_ttml_sources", Value: model.JSONMap{"value": sources}}).Error; err != nil {
						return err
					}
				}
			}
			return tx.Where("key = ?", "music_ttml_url_template").Delete(&kv2026110501{}).Error
		},
	}
}
