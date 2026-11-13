// Package migrations 版本迁移：表结构与数据的非增量改动（删列、重命名、改类型、索引变更、回填、一次性修数）都写在这里。
//
// 约定：
//   - ID 格式为 YYYYMMDDNN_snake_case，只增不改；已发布的迁移不得修改，修正问题请写新迁移
//   - List 的顺序即执行顺序，新迁移追加在末尾
//   - 迁移在 AutoMigrate 之前执行：用到的表或列若不是更早的迁移创建的，先用 HasTable / HasColumn 判断并补建
//   - 迁移内定义当时的快照结构体，不要依赖会变化的 model 结构体做 DDL
//   - 必须同时兼容 SQLite 与 Postgres，优先使用 tx.Migrator()
package migrations

import "github.com/go-gormigrate/gormigrate/v2"

// List 全部版本迁移，按执行顺序排列
func List() []*gormigrate.Migration {
	return []*gormigrate.Migration{
		likeUniqueCleanup(),
		postContentHashBackfill(),
		lyricAnnotationPaceBeat(),
		musicTTMLSources(),
		clearUnknownGender(),
		agentExpertTone(),
		postPinning(),
		agentMentionTrigger(),
		notificationActivityClaim(),
		lyricAnnotationPhrases(),
		postExcerpt(),
		siteInfoOldDefaults(),
		dropMusicStaticPlaylist(),
		relativeFileLinks(),
		postLabelsIndex(),
	}
}
