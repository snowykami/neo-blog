package model

import "time"

// LyricTranslation 歌词的多语言 AI 翻译缓存：按「歌曲 + 歌词来源 + 歌词文本哈希 + 目标语言」唯一保存。
// 歌词内容变化后哈希不同即重新生成；Data 为 JSON（见 service.lyricTranslationData），可为空列表（表示模型判定全曲无需翻译）。
type LyricTranslation struct {
	ID         uint      `gorm:"primarykey"`
	SongID     int64     `gorm:"not null;uniqueIndex:idx_lyric_translation_key"`
	Source     string    `gorm:"type:varchar(32);not null;uniqueIndex:idx_lyric_translation_key"`
	LyricHash  string    `gorm:"type:varchar(64);not null;uniqueIndex:idx_lyric_translation_key"`
	TargetLang string    `gorm:"type:varchar(16);not null;uniqueIndex:idx_lyric_translation_key"`
	Data       string    `gorm:"type:text;not null"`
	Model      string    `gorm:"type:varchar(128)"`
	CreatedAt  time.Time `gorm:"index"`
}
