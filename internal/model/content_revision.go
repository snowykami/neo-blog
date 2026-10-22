package model

import (
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
)

// ContentRevision 文章 / 页面的历史版本：正文（草稿）与元信息的完整快照
type ContentRevision struct {
	ID            uint      `gorm:"primarykey"`
	CreatedAt     time.Time `gorm:"index"`
	TargetType    string    `gorm:"type:varchar(20);index:idx_revision_target"` // post / page
	TargetID      uint      `gorm:"index:idx_revision_target"`
	Kind          string    `gorm:"type:varchar(20)"` // publish 发布 / session 编辑起点 / autosave 自动保存 / backup 恢复前备份
	EditSessionID string    `gorm:"type:varchar(64)"`
	UserID        uint      `gorm:"index"`
	User          User      `gorm:"foreignKey:UserID;references:ID"`
	Title         string    `gorm:"type:text"`
	Content       string    `gorm:"type:text"`
	Meta          string    `gorm:"type:text"`        // dto.RevisionMeta 的 JSON
	Hash          string    `gorm:"type:varchar(64)"` // 正文 + 元信息的哈希，用于去重
	WordCount     int
}

func (r *ContentRevision) ToDto() *dto.RevisionDto {
	return &dto.RevisionDto{
		ID:        r.ID,
		Kind:      r.Kind,
		Title:     r.Title,
		WordCount: r.WordCount,
		User:      r.User.ToDto(),
		CreatedAt: r.CreatedAt,
	}
}
