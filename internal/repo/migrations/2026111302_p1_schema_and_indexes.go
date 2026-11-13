package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

type post2026111302 struct {
	IsDraft  bool `gorm:"not null;default:false"`
	HasDraft bool `gorm:"not null;default:false"`
}

func (post2026111302) TableName() string { return "posts" }

type page2026111302 struct {
	HasDraft bool `gorm:"not null;default:false"`
}

func (page2026111302) TableName() string { return "pages" }

type kv2026111302 struct {
	Secret bool `gorm:"not null;default:false"`
}

func (kv2026111302) TableName() string { return "kvs" }

type agentRun2026111302 struct {
	LeaseToken string `gorm:"type:varchar(64);default:''"`
}

func (agentRun2026111302) TableName() string { return "agent_runs" }

// p1SchemaAndIndexes 补充 P1 批次的字段、唯一约束前清理与查询组合索引：
//   - user_open_ids 加 (issuer, sub) 唯一索引前清理软删除与并发重复行
//   - posts 增加 is_draft（未首次发布草稿）与 has_draft（存在未发布草稿改动）并回填
//   - pages 增加 has_draft 并回填
//   - kvs 增加 secret 布尔标记并自动标记已注册的密钥项
//   - agent_runs 增加 lease_token 租约围栏令牌
//   - visit_logs / likes / comments / posts 补充高频查询组合索引
func p1SchemaAndIndexes() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026111302_p1_schema_and_indexes",
		Migrate: func(tx *gorm.DB) error {
			if tx.Migrator().HasTable("user_open_ids") && !tx.Migrator().HasIndex("user_open_ids", "idx_user_openid_issuer_sub") {
				if err := tx.Exec("DELETE FROM user_open_ids WHERE deleted_at IS NOT NULL").Error; err != nil {
					return err
				}
				if err := tx.Exec("DELETE FROM user_open_ids WHERE id NOT IN (SELECT MIN(id) FROM user_open_ids GROUP BY issuer, sub)").Error; err != nil {
					return err
				}
			}

			if tx.Migrator().HasTable(&post2026111302{}) {
				if !tx.Migrator().HasColumn(&post2026111302{}, "is_draft") {
					if err := tx.Migrator().AddColumn(&post2026111302{}, "IsDraft"); err != nil {
						return err
					}
				}
				if !tx.Migrator().HasColumn(&post2026111302{}, "has_draft") {
					if err := tx.Migrator().AddColumn(&post2026111302{}, "HasDraft"); err != nil {
						return err
					}
					if tx.Migrator().HasColumn("posts", "draft_content") && tx.Migrator().HasColumn("posts", "content") {
						if err := tx.Exec("UPDATE posts SET has_draft = ? WHERE draft_content IS NOT NULL AND draft_content <> '' AND draft_content <> content", true).Error; err != nil {
							return err
						}
					}
				}
				for _, dropSQL := range []string{
					"DROP INDEX IF EXISTS idx_posts_list_created",
					"DROP INDEX IF EXISTS idx_posts_list_heat",
				} {
					if err := tx.Exec(dropSQL).Error; err != nil {
						return err
					}
				}
				for _, createSQL := range []string{
					"CREATE INDEX IF NOT EXISTS idx_posts_list_created ON posts (is_private, is_draft, created_at)",
					"CREATE INDEX IF NOT EXISTS idx_posts_list_heat ON posts (is_private, is_draft, heat)",
				} {
					if err := tx.Exec(createSQL).Error; err != nil {
						return err
					}
				}
			}

			if tx.Migrator().HasTable(&page2026111302{}) && !tx.Migrator().HasColumn(&page2026111302{}, "has_draft") {
				if err := tx.Migrator().AddColumn(&page2026111302{}, "HasDraft"); err != nil {
					return err
				}
				if tx.Migrator().HasColumn("pages", "draft_content") && tx.Migrator().HasColumn("pages", "content") {
					if err := tx.Exec("UPDATE pages SET has_draft = ? WHERE draft_content IS NOT NULL AND draft_content <> '' AND draft_content <> content", true).Error; err != nil {
						return err
					}
				}
			}

			if tx.Migrator().HasTable(&kv2026111302{}) {
				if !tx.Migrator().HasColumn(&kv2026111302{}, "secret") {
					if err := tx.Migrator().AddColumn(&kv2026111302{}, "Secret"); err != nil {
						return err
					}
				}
				secretKeys := []string{
					"meilisearch_api_key",
					"ncm_cookie",
					"qweather_api_key",
					"captcha_secret_key",
					"email_password",
					"ai_api_key",
				}
				if err := tx.Exec("UPDATE kvs SET secret = ? WHERE key IN ?", true, secretKeys).Error; err != nil {
					return err
				}
			}

			if tx.Migrator().HasTable(&agentRun2026111302{}) && !tx.Migrator().HasColumn(&agentRun2026111302{}, "lease_token") {
				if err := tx.Migrator().AddColumn(&agentRun2026111302{}, "LeaseToken"); err != nil {
					return err
				}
			}

			tableIndexes := []struct {
				table string
				sql   string
			}{
				{"visit_logs", "CREATE INDEX IF NOT EXISTS idx_visit_logs_action_created ON visit_logs (action, created_at)"},
				{"visit_logs", "CREATE INDEX IF NOT EXISTS idx_visit_logs_visitor_created ON visit_logs (visitor_id, created_at)"},
				{"likes", "CREATE INDEX IF NOT EXISTS idx_likes_user_created ON likes (user_id, created_at)"},
				{"likes", "CREATE INDEX IF NOT EXISTS idx_likes_created ON likes (created_at)"},
				{"comments", "CREATE INDEX IF NOT EXISTS idx_comments_user_created ON comments (user_id, created_at)"},
				{"comments", "CREATE INDEX IF NOT EXISTS idx_comments_root_depth ON comments (root_id, depth, id)"},
				{"comments", "CREATE INDEX IF NOT EXISTS idx_comments_created ON comments (created_at)"},
			}
			for _, item := range tableIndexes {
				if tx.Migrator().HasTable(item.table) {
					if err := tx.Exec(item.sql).Error; err != nil {
						return err
					}
				}
			}
			return nil
		},
	}
}
