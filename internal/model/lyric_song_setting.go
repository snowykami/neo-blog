package model

import "time"

// LyricSongSetting 一首歌的歌词人工设置（与按来源保存的 LyricSetting 同属「歌词的人工设置」，见 docs/music-player-spec.md 7.2n）：
// PinnedKind 为管理员选定的全站默认歌词来源（ttml / ncm / qq / kugou），所有读者默认显示这一来源，读者仍可在本地临时切换
type LyricSongSetting struct {
	ID         uint   `gorm:"primaryKey"`
	SongID     int64  `gorm:"not null;uniqueIndex"`
	PinnedKind string `gorm:"type:varchar(16);not null;default:''"`
	UpdatedAt  time.Time
}
