package model

import "time"

// LyricDirector 歌词双阶段翻译 Stage 1（Router 导演策划）缓存：
// 按「歌曲 ID + 歌词文本哈希」唯一保存，跨多目标语言复用，并向歌词特效标注提供 visual_theme。
type LyricDirector struct {
	ID        uint      `gorm:"primaryKey"`
	SongID    int64     `gorm:"not null;uniqueIndex:idx_lyric_director_song_hash"`
	LyricHash string    `gorm:"type:varchar(64);not null;uniqueIndex:idx_lyric_director_song_hash"`
	Data      string    `gorm:"type:text;not null"`
	Model     string    `gorm:"type:varchar(128)"`
	CreatedAt time.Time `gorm:"index"`
}
