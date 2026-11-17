package model

import "time"

// MusicMVSetting 单曲 MV 人工设置：按网易云歌曲 ID 唯一保存管理员调整的 MV 时间轴偏移与禁用状态
type MusicMVSetting struct {
	ID         uint  `gorm:"primaryKey"`
	SongID     int64 `gorm:"not null;uniqueIndex"`
	MVOffsetMs int   `gorm:"column:mv_offset_ms;not null;default:0"`
	MVDisabled bool  `gorm:"column:mv_disabled;not null;default:false"`
	UpdatedAt  time.Time
}
