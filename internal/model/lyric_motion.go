package model

import "time"

// LyricMotion 歌词上浮弹性（全曲滚动物理预设）独立缓存：
// 按「歌曲 ID + 歌词文本哈希」唯一保存，既可由逐字歌词特效全曲规划顺带写入，也可在逐行 LRC 或未开启特效时独立生成与刷新。
type LyricMotion struct {
	ID        uint      `gorm:"primaryKey"`
	SongID    int64     `gorm:"not null;uniqueIndex:idx_lyric_motion_song_hash"`
	LyricHash string    `gorm:"type:varchar(64);not null;uniqueIndex:idx_lyric_motion_song_hash"`
	Motion    string    `gorm:"type:varchar(24);not null"`
	Source    string    `gorm:"type:varchar(32);not null;default:''"`
	Model     string    `gorm:"type:varchar(128)"`
	CreatedAt time.Time `gorm:"index"`
	UpdatedAt time.Time
}
