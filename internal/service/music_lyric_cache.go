package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
)

// 歌词缓存（见 docs/music-player-spec.md 7.2e）：后端选出一首歌的全站歌词版本后（见 music_lyric_version.go），
// 用自己获取的来源数据保存这一版本的快照（不接受前端上传的歌词或来源）；之后打开这首歌时先返回快照立即显示（歌词流的第一条事件），
// 各来源的实时结果照常到达并替换，所以每次播放都是对快照的一次更新。与歌词标注分开保存，互不影响

const lyricCacheTTL = 30 * 24 * time.Hour

var lyricCacheKinds = map[string]bool{"ttml": true, "ncm": true, "qq": true, "kugou": true}

// GetLyricCache 一首歌的歌词缓存快照；没有或已过期时 404
func (s *MusicService) GetLyricCache(ctx context.Context, id int64) (*dto.MusicLyricCacheDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	var record model.LyricCache
	err := repo.GetDB().WithContext(ctx).Where("song_id = ?", id).First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && time.Since(record.UpdatedAt) > lyricCacheTTL) {
		return nil, errs.NewNotFound("lyric_cache_miss")
	}
	if err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	var snapshot dto.MusicLyricCacheDto
	if json.Unmarshal([]byte(record.Data), &snapshot) != nil {
		return nil, errs.NewNotFound("lyric_cache_miss")
	}
	snapshot.Kind = record.Kind
	return &snapshot, nil
}
