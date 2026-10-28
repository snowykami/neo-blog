package model

import "time"

// LyricCache 歌词缓存（与歌词标注分开保存）：一首歌最近一次选出的最佳歌词来源（kind：ttml / ncm / qq）及其原始数据，
// 由后端用自己获取的来源数据写入（前端只上报胜出的来源）；Data 为各来源响应的 JSON 快照，过期后不再返回
type LyricCache struct {
	ID        uint   `gorm:"primaryKey"`
	SongID    int64  `gorm:"not null;uniqueIndex"`
	Kind      string `gorm:"type:varchar(16);not null"`
	Data      string `gorm:"type:text;not null"`
	UpdatedAt time.Time
}
