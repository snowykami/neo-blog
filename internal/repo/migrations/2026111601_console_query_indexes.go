package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// consoleQueryIndexes 为后台控制台高频筛选与游标排序查询补充缺失索引（同时兼容 SQLite 与 Postgres）：
//   - files: user_id / provider_id / mime_type / created_at / size
//   - visitors: created_at
//   - visit_logs: (created_at, id) / device_type / inferred_country
//   - error_issues: (status, last_seen_at, id)
func consoleQueryIndexes() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026111601_console_query_indexes",
		Migrate: func(tx *gorm.DB) error {
			specs := []struct {
				table   string
				columns []string
				sql     string
			}{
				{"files", []string{"user_id"}, "CREATE INDEX IF NOT EXISTS idx_files_user_id ON files (user_id)"},
				{"files", []string{"provider_id"}, "CREATE INDEX IF NOT EXISTS idx_files_provider_id ON files (provider_id)"},
				{"files", []string{"mime_type"}, "CREATE INDEX IF NOT EXISTS idx_files_mime_type ON files (mime_type)"},
				{"files", []string{"created_at"}, "CREATE INDEX IF NOT EXISTS idx_files_created ON files (created_at)"},
				{"files", []string{"size"}, "CREATE INDEX IF NOT EXISTS idx_files_size ON files (size)"},
				{"visitors", []string{"created_at"}, "CREATE INDEX IF NOT EXISTS idx_visitors_created_at ON visitors (created_at)"},
				{"visit_logs", []string{"created_at", "id"}, "CREATE INDEX IF NOT EXISTS idx_visit_logs_created_id ON visit_logs (created_at, id)"},
				{"visit_logs", []string{"device_type"}, "CREATE INDEX IF NOT EXISTS idx_visit_logs_device_type ON visit_logs (device_type)"},
				{"visit_logs", []string{"inferred_country"}, "CREATE INDEX IF NOT EXISTS idx_visit_logs_inferred_country ON visit_logs (inferred_country)"},
				{"error_issues", []string{"status", "last_seen_at", "id"}, "CREATE INDEX IF NOT EXISTS idx_error_issues_status_last_seen ON error_issues (status, last_seen_at, id)"},
			}
			for _, spec := range specs {
				if !tx.Migrator().HasTable(spec.table) {
					continue
				}
				ready := true
				for _, col := range spec.columns {
					if !tx.Migrator().HasColumn(spec.table, col) {
						ready = false
						break
					}
				}
				if !ready {
					continue
				}
				if err := tx.Exec(spec.sql).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
