package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// postLabelsIndex 补充标签反查与文章热度统计的组合索引：
//   - post_labels 默认主键为 (post_id, label_id)，按 label_id 统计文章数与筛文章需要反向前缀索引 (label_id, post_id)
//   - visit_logs 热度窗口扫描按 (action, target_type, created_at, target_id) 过滤
func postLabelsIndex() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026111301_post_labels_index",
		Migrate: func(tx *gorm.DB) error {
			if tx.Migrator().HasTable("post_labels") {
				if err := tx.Exec("CREATE INDEX IF NOT EXISTS idx_post_labels_label_post ON post_labels (label_id, post_id)").Error; err != nil {
					return err
				}
			}
			if tx.Migrator().HasTable("visit_logs") {
				if err := tx.Exec("CREATE INDEX IF NOT EXISTS idx_visit_logs_heat ON visit_logs (action, target_type, created_at, target_id)").Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
