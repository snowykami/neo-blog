package model

import "time"

// LyricCache 歌词缓存与全站歌词版本（与歌词标注分开保存，见 docs/music-player-spec.md 7.2e、7.2o）：
// 后端为一首歌选出的全站版本——来源（kind：ttml / ncm / qq / kugou）、具体来源（source，与前端 ResolvedLyrics.source 一致）、
// 这份歌词各行文本的哈希（lyric_hash，与歌词标注的 lyric_hash 相同）——及其原始数据。Data 为各来源响应的 JSON 快照；
// 版本只升不降、长期保留，快照超过有效期后不再作为缓存返回。旧数据（前端上报来源时写入）没有 source 与 lyric_hash
type LyricCache struct {
	ID        uint   `gorm:"primaryKey"`
	SongID    int64  `gorm:"not null;uniqueIndex"`
	Kind      string `gorm:"type:varchar(16);not null"`
	Source    string `gorm:"type:varchar(32);not null;default:''"`
	LyricHash string `gorm:"type:varchar(64);not null;default:''"`
	Data      string `gorm:"type:text;not null"`
	UpdatedAt time.Time
}
