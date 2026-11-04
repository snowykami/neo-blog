package model

import (
	"crypto/md5"
	"encoding/hex"
	"time"
)

// CommentTranslation 评论的 AI 译文缓存：每条评论每种目标语言一条，与翻译时评论内容的 MD5 绑定；
// 评论内容变化（MD5 不一致）或评论被删除时，该评论的全部译文直接删除
type CommentTranslation struct {
	ID         uint   `gorm:"primaryKey"`
	CommentID  uint   `gorm:"not null;uniqueIndex:idx_comment_translation_lang"`
	TargetLang string `gorm:"type:varchar(16);not null;uniqueIndex:idx_comment_translation_lang"` // 目标语言（界面语言代码）
	ContentMD5 string `gorm:"column:content_md5;type:varchar(32);not null"`                       // 翻译时评论内容的 MD5
	SourceLang string `gorm:"type:varchar(16);not null"`                                          // AI 识别出的源语言
	Content    string `gorm:"type:text;not null"`                                                 // 译文；源语言与目标语言相同时为空
	CreatedAt  time.Time
}

// CommentContentMD5 计算评论内容的 MD5，用于判断译文是否过期
func CommentContentMD5(content string) string {
	sum := md5.Sum([]byte(content))
	return hex.EncodeToString(sum[:])
}
