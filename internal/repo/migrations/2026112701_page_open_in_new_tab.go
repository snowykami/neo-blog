package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

type page2026112701 struct {
	OpenInNewTab bool `gorm:"default:false"`
}

func (page2026112701) TableName() string { return "pages" }

// pageOpenInNewTab 新增 pages.open_in_new_tab 字段，并将旧版中指向 http(s) 站外地址的链接页面回填为 true（保持原有站外链接新标签页打开行为）。
func pageOpenInNewTab() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026112701_page_open_in_new_tab",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable("pages") {
				return nil
			}
			if !tx.Migrator().HasColumn("pages", "open_in_new_tab") {
				if err := tx.Migrator().AddColumn(&page2026112701{}, "OpenInNewTab"); err != nil {
					return err
				}
			}
			if !tx.Migrator().HasColumn("pages", "kind") || !tx.Migrator().HasColumn("pages", "link_url") {
				return nil
			}
			return tx.Exec(
				"UPDATE pages SET open_in_new_tab = ? WHERE kind = ? AND (LOWER(link_url) LIKE 'http://%' OR LOWER(link_url) LIKE 'https://%')",
				true, "link",
			).Error
		},
	}
}
