package model

import "time"

// LyricSingerAnnotation 歌词多声部 / 歌手分配独立缓存：按「歌曲 ID + 歌词来源 + 歌词文本哈希」唯一保存，
// 覆盖 TTML ttm:agent 与 LRC/YRC/QRC 对唱标注；Translations 按目标语言增量缓存歌手名翻译（targetLang -> singerID -> name）。
type LyricSingerAnnotation struct {
	ID           uint      `gorm:"primarykey"`
	SongID       int64     `gorm:"not null;uniqueIndex:idx_lyric_singer_annotation_version,priority:1"`
	Source       string    `gorm:"type:varchar(32);not null;uniqueIndex:idx_lyric_singer_annotation_version,priority:2"`
	LyricHash    string    `gorm:"type:varchar(64);not null;uniqueIndex:idx_lyric_singer_annotation_version,priority:3"`
	Data         string    `gorm:"type:text;not null"`
	Translations string    `gorm:"type:text;not null;default:'{}'"`
	Model        string    `gorm:"type:varchar(128)"`
	CreatedAt    time.Time `gorm:"index"`
	UpdatedAt    time.Time
}
