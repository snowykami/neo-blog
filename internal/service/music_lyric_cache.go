package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 歌词缓存（见 docs/music-player-spec.md 7.2e）：前端选出一首歌的最佳歌词来源后上报来源类型，
// 后端用自己获取的来源数据（不接受前端上传的歌词内容，避免缓存被写入假歌词）保存快照；之后打开这首歌时先返回快照立即显示，
// 各来源的实时请求照常进行并在完成后替换，所以每次播放都是对快照的一次更新。与歌词标注分开保存，互不影响

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

// SaveLyricCache 按前端选出的最佳来源保存快照：胜出的来源没有歌词时不保存
func (s *MusicService) SaveLyricCache(ctx context.Context, id int64, kind string) *errs.ServiceError {
	if id <= 0 || !lyricCacheKinds[kind] {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	snapshot, ok := s.lyricCacheSnapshot(ctx, id, kind)
	if !ok {
		return errs.NewNotFound("lyric_not_found")
	}
	data, _ := json.Marshal(snapshot)
	record := &model.LyricCache{SongID: id, Kind: kind, Data: string(data), UpdatedAt: time.Now()}
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "song_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"kind", "data", "updated_at"}),
	}
	if err := repo.GetDB().WithContext(ctx).Clauses(upsert).Create(record).Error; err != nil {
		logrus.Errorf("save lyric cache for song %d failed: %v", id, err)
		return errs.NewInternalServer("failed_to_update_target")
	}
	return nil
}

// lyricCacheSnapshot 用后端自己的来源数据组装快照（网易云歌词总会附带）；胜出的来源没有歌词时返回 false
func (s *MusicService) lyricCacheSnapshot(ctx context.Context, id int64, kind string) (dto.MusicLyricCacheDto, bool) {
	snapshot := dto.MusicLyricCacheDto{Kind: kind}
	if lyric, svcerr := s.GetLyric(ctx, id); svcerr == nil {
		snapshot.Ncm = lyric
	}
	switch kind {
	case "ncm":
		return snapshot, snapshot.Ncm != nil && snapshot.Ncm.Lrc != nil && len(lyricTextLines(snapshot.Ncm.Lrc.Lyric)) > 0
	case "ttml":
		// TTML 可能按网易云歌曲收录，也可能按匹配到的 QQ 歌曲收录（随 QQ 歌词返回）
		if ttml, svcerr := s.GetTTMLLyric(ctx, id, ""); svcerr == nil && ttml.TTML != "" {
			snapshot.TTML = ttml
			return snapshot, true
		}
		if qq, svcerr := s.GetQQLyric(ctx, id); svcerr == nil && qq.TTML != "" {
			snapshot.QQ = qq
			return snapshot, true
		}
		return snapshot, false
	case "kugou":
		kugou, svcerr := s.GetKugouLyric(ctx, id)
		if svcerr != nil {
			return snapshot, false
		}
		snapshot.Kugou = kugou
		return snapshot, true
	default:
		qq, svcerr := s.GetQQLyric(ctx, id)
		if svcerr != nil || qq.Lyric == "" {
			return snapshot, false
		}
		snapshot.QQ = qq
		return snapshot, true
	}
}
