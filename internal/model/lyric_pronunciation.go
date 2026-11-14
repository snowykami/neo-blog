package model

import "time"

// LyricPronunciation 歌词读音（拼音 / 粤拼 / 注音 / IPA / 罗马音）独立缓存：
// 按「歌曲 ID + 歌词来源 + 歌词文本哈希」唯一保存，与界面语言无关（同一词源只有一套本语种标准读音）。
type LyricPronunciation struct {
	ID        uint      `gorm:"primarykey"`
	SongID    int64     `gorm:"not null;uniqueIndex:idx_lyric_pronunciation_version,priority:1"`
	Source    string    `gorm:"type:varchar(32);not null;uniqueIndex:idx_lyric_pronunciation_version,priority:2"`
	LyricHash string    `gorm:"type:varchar(64);not null;uniqueIndex:idx_lyric_pronunciation_version,priority:3"`
	Lang      string    `gorm:"type:varchar(16);not null;default:''"`
	Data      string    `gorm:"type:text;not null"`
	Model     string    `gorm:"type:varchar(128)"`
	CreatedAt time.Time `gorm:"index"`
	UpdatedAt time.Time
}
