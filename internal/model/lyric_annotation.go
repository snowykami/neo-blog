package model

import "time"

// LyricAnnotation 歌词标注（大模型对歌词文本的一次性标注，见 docs/music-player-spec.md 7.2b）：
// 按网易云歌曲 id 与歌词文本的哈希保存，歌词文本变化后重新标注；Data 为标注结果的 JSON，只引用歌词文本，不含任何时间。
// CreatedAt 为本次标注的生成时间：超过有效期或管理员手动刷新后重新生成，覆盖 Data、Model 与 CreatedAt。
// EditedAt 为管理员在后台手动编辑的时间（未编辑时为空）：编辑过的标注不再因过期自动重新生成，只有管理员手动刷新时覆盖（同时清空 EditedAt）
type LyricAnnotation struct {
	ID        uint   `gorm:"primaryKey"`
	SongID    int64  `gorm:"not null;uniqueIndex:idx_lyric_annotation_song_hash"`
	LyricHash string `gorm:"type:varchar(64);not null;uniqueIndex:idx_lyric_annotation_song_hash"`
	Data      string `gorm:"type:text;not null"`
	Model     string `gorm:"type:varchar(128)"`
	CreatedAt time.Time
	EditedAt  *time.Time
}
