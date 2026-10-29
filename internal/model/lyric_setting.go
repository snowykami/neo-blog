package model

import "time"

// LyricSetting 歌词的人工设置（与歌词标注、歌词缓存分开保存，见 docs/music-player-spec.md 7.2l）：按网易云歌曲 id 与歌词来源
// （ResolvedLyrics.source，如 ncm-yrc、qq-qrc、ttml-custom）各存一份，不同来源的时间轴不同；OffsetMs 为管理员微调的整体偏移
// （毫秒，正数让歌词推迟、负数让歌词提前），所有人播放时都按它显示
type LyricSetting struct {
	ID        uint   `gorm:"primaryKey"`
	SongID    int64  `gorm:"not null;uniqueIndex:idx_lyric_setting_song_source"`
	Source    string `gorm:"type:varchar(16);not null;uniqueIndex:idx_lyric_setting_song_source"`
	OffsetMs  int    `gorm:"not null;default:0"`
	UpdatedAt time.Time
}
