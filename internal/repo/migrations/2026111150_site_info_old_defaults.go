package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
)

// kv2026111150 迁移时的配置表快照：值存为 {"value": 实际值}
type kv2026111150 struct {
	Key   string `gorm:"primaryKey;type:varchar(64)"`
	Value model.JSONMap
}

func (kv2026111150) TableName() string { return "kvs" }

// siteInfoOldDefaults2026111150 改为中性占位之前，配置注册表里站点信息相关项的默认值（作者的个人信息与占位备案号）
var siteInfoOldDefaults2026111150 = []struct {
	key   string // 同名独立配置键
	path  []string
	value any
}{
	{"site_name", []string{"metadata", "name"}, "Snowykami's Blog"},
	{"site_icon", []string{"metadata", "icon"}, "https://cdn.liteyuki.org/snowykami/avatar_alpha.png"},
	{"default_cover", []string{"default_cover"}, []any{
		"https://cdn.liteyuki.org/snowykami/image/1759709826590.webp",
		"https://cdn.liteyuki.org/snowykami/image/1759710439228.webp",
		"https://cdn.liteyuki.org/snowykami/image/1759710339517.webp",
		"https://cdn.liteyuki.org/snowykami/image/furina.png",
		"https://cdn.liteyuki.org/snowykami/image/1759710500693.webp",
	}},
	{"owner_name", []string{"owner", "name"}, "SnowyKami"},
	{"owner_description", []string{"owner", "description"}, "A full-stack developer."},
	{"owner_avatar", []string{"owner", "avatar"}, "https://cdn.liteyuki.org/snowykami/avatar.jpg"},
	{"footer_text", []string{"footer", "text"}, "Liteyuki ICP 114514"},
	{"about_background", []string{"about_background"}, "https://cdn.liteyuki.org/snowykami/dark_2.png"},
}

// siteInfoOldDefaults 站点信息相关的默认值改为中性占位（站名、站长、图标、封面、页脚、关于卡片背景）。
// 已在后台保存过站点信息的站点不应受影响：其中缺少某项、也没有同名独立配置键时，前台此前显示的就是旧默认值，
// 把旧默认值补进已保存的站点信息，保持现状。从未保存过站点信息的站点不处理，按新的默认值显示
func siteInfoOldDefaults() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026111150_site_info_old_defaults",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable(&kv2026111150{}) {
				return nil
			}
			var rows []kv2026111150
			if err := tx.Where("key = ?", "site_info").Find(&rows).Error; err != nil || len(rows) == 0 {
				return err
			}
			info, ok := rows[0].Value["value"].(map[string]any)
			if !ok {
				return nil
			}
			changed := false
			for _, item := range siteInfoOldDefaults2026111150 {
				if hasPath2026111150(info, item.path) {
					continue
				}
				var count int64
				if err := tx.Model(&kv2026111150{}).Where("key = ?", item.key).Count(&count).Error; err != nil {
					return err
				}
				if count > 0 {
					continue
				}
				setPath2026111150(info, item.path, item.value)
				changed = true
			}
			if !changed {
				return nil
			}
			return tx.Model(&kv2026111150{}).Where("key = ?", "site_info").Update("value", model.JSONMap{"value": info}).Error
		},
	}
}

func hasPath2026111150(m map[string]any, path []string) bool {
	for i, key := range path {
		v, ok := m[key]
		if !ok || v == nil {
			return false
		}
		if i == len(path)-1 {
			return true
		}
		if m, ok = v.(map[string]any); !ok {
			return false
		}
	}
	return false
}

func setPath2026111150(m map[string]any, path []string, v any) {
	for _, key := range path[:len(path)-1] {
		next, ok := m[key].(map[string]any)
		if !ok {
			next = map[string]any{}
			m[key] = next
		}
		m = next
	}
	m[path[len(path)-1]] = v
}
