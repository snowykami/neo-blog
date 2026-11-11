package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
)

// kv2026111160 迁移时的配置表快照：值存为 {"value": 实际值}
type kv2026111160 struct {
	Key   string `gorm:"primaryKey;type:varchar(64)"`
	Value model.JSONMap
}

func (kv2026111160) TableName() string { return "kvs" }

// musicStaticPlaylistKeys2026111160 已移除的歌单来源配置：歌单来源（静态 JSON / 网易云）与静态歌单 JSON 地址
var musicStaticPlaylistKeys2026111160 = []string{"music_source", "music_playlist_url"}

// dropMusicStaticPlaylist 音乐播放器只用网易云歌单，不再支持静态 JSON 歌单：
// 删掉已保存的站点信息里的这两项（前台会原样读到站点信息），以及旧数据里的同名独立配置键
func dropMusicStaticPlaylist() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "2026111160_drop_music_static_playlist",
		Migrate: func(tx *gorm.DB) error {
			if !tx.Migrator().HasTable(&kv2026111160{}) {
				return nil
			}
			if err := tx.Where("key IN ?", musicStaticPlaylistKeys2026111160).Delete(&kv2026111160{}).Error; err != nil {
				return err
			}
			var rows []kv2026111160
			if err := tx.Where("key = ?", "site_info").Find(&rows).Error; err != nil || len(rows) == 0 {
				return err
			}
			info, ok := rows[0].Value["value"].(map[string]any)
			if !ok {
				return nil
			}
			changed := false
			for _, key := range musicStaticPlaylistKeys2026111160 {
				if _, ok := info[key]; ok {
					delete(info, key)
					changed = true
				}
			}
			if !changed {
				return nil
			}
			return tx.Model(&kv2026111160{}).Where("key = ?", "site_info").Update("value", model.JSONMap{"value": info}).Error
		},
	}
}
