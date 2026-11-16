package model

import "time"

// MusicSongRhythm 歌曲节拍与起音分析缓存（按网易云歌曲 ID 唯一保存）：
// 由后端 ffmpeg 解码分析生成，或在后端未启用 ffmpeg 时由管理员浏览器分析后上传；全站读者共用
type MusicSongRhythm struct {
	ID          uint      `gorm:"primaryKey"`
	SongID      int64     `gorm:"not null;uniqueIndex"`
	AlgoVersion int       `gorm:"not null;default:1"`
	DurationMs  float64   `gorm:"not null;default:0"`
	Source      string    `gorm:"type:varchar(16);not null;default:''"`
	Data        string    `gorm:"type:text;not null"`
	UpdatedAt   time.Time
}
