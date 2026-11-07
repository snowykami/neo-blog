package repo

import (
	"errors"

	"gorm.io/gorm"
)

// ErrDraftVersionConflict 保存正文时草稿版本号已变化：读取之后有其他写入（其他编辑页、外部 AI 工具）
var ErrDraftVersionConflict = errors.New("draft version conflict")

// bumpDraftVersion 在事务中把草稿版本号从 expected 原子地加一；版本号不是 expected 时返回 ErrDraftVersionConflict
// 条件更新会锁住这一行直到事务结束（Postgres 行锁 / SQLite 写锁），同一篇内容的并发写入因此串行
func bumpDraftVersion(tx *gorm.DB, model any, id uint, expected uint64) error {
	result := tx.Model(model).Where("id = ? AND draft_version = ?", id, expected).
		UpdateColumn("draft_version", gorm.Expr("draft_version + 1"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrDraftVersionConflict
	}
	return nil
}
