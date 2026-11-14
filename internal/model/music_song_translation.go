package model

import "time"

// MusicSongTranslation 歌曲标题与歌手名的多语言 AI 翻译缓存：按「歌曲 ID + 目标语言」唯一保存；
// 歌曲原名或歌手列表变化后对比 MetaHash 自动刷新，Title / Artists 与曲目元信息一一对应。
type MusicSongTranslation struct {
	ID         uint      `gorm:"primarykey"`
	SongID     int64     `gorm:"not null;uniqueIndex:idx_music_song_translation_key,priority:1"`
	TargetLang string    `gorm:"type:varchar(16);not null;uniqueIndex:idx_music_song_translation_key,priority:2"`
	MetaHash   string    `gorm:"type:varchar(64);not null"`
	Title      string    `gorm:"type:varchar(512);not null;default:''"`
	Artists    string    `gorm:"type:text;not null;default:'[]'"`
	Model      string    `gorm:"type:varchar(128)"`
	CreatedAt  time.Time `gorm:"index"`
	UpdatedAt  time.Time
}
