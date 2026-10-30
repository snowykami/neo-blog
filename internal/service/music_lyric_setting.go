package service

import (
	"context"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/internal/repo"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm/clause"
)

// 歌词的人工设置（见 docs/music-player-spec.md 7.2l、7.2n）：整体偏移（按来源分别保存，不同来源的时间轴不同）
// 与全站默认歌词来源（按歌曲保存）。管理员在播放器里调整后保存，所有人播放这首歌时都按它显示

// lyricOffsetMaxMs 整体偏移的上限（毫秒）
const lyricOffsetMaxMs = 10000

// lyricSettingSources 可以保存设置的歌词来源，与前端 ResolvedLyrics.source 一致
var lyricSettingSources = map[string]bool{
	"ttml-custom": true, "ttml-amll": true, "ncm-yrc": true, "ncm-lrc": true,
	"qq-qrc": true, "qq-lrc": true, "kugou-krc": true, "kugou-lrc": true,
}

// GetLyricSettings 一首歌各歌词来源的整体偏移（公开：所有人播放时都要用到，不含敏感信息）
func (s *MusicService) GetLyricSettings(ctx context.Context, id int64) (*dto.MusicLyricSettingsDto, *errs.ServiceError) {
	if id <= 0 {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	var records []model.LyricSetting
	if err := repo.GetDB().WithContext(ctx).Where("song_id = ?", id).Find(&records).Error; err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	result := &dto.MusicLyricSettingsDto{Offsets: map[string]int{}}
	for _, record := range records {
		if record.OffsetMs != 0 {
			result.Offsets[record.Source] = record.OffsetMs
		}
	}
	var song model.LyricSongSetting
	if err := repo.GetDB().WithContext(ctx).Where("song_id = ?", id).Limit(1).Find(&song).Error; err != nil {
		return nil, errs.NewInternalServer("failed_to_get_target")
	}
	result.Pin = song.PinnedKind
	return result, nil
}

// SaveLyricPin 设置一首歌的全站默认歌词来源（仅管理员，由路由限制）；kind 为空时取消（恢复按质量自动选择）。
// 保存后立即重新选择全站歌词版本（见 music_lyric_version.go）并返回；版本有变化时按新版本生成歌词特效
// （这份歌词已有标注时直接使用，不重复消耗模型额度；旧版本的标注保留，切换回去时仍可使用）
func (s *MusicService) SaveLyricPin(ctx context.Context, id int64, kind string) (*dto.MusicLyricVersionDto, *errs.ServiceError) {
	if id <= 0 || (kind != "" && !lyricCacheKinds[kind]) {
		return nil, errs.NewBadRequest("invalid_request_parameters")
	}
	db := repo.GetDB().WithContext(ctx)
	if kind == "" {
		if err := db.Where("song_id = ?", id).Delete(&model.LyricSongSetting{}).Error; err != nil {
			return nil, errs.NewInternalServer("failed_to_update_target")
		}
	} else {
		record := &model.LyricSongSetting{SongID: id, PinnedKind: kind, UpdatedAt: time.Now()}
		upsert := clause.OnConflict{
			Columns:   []clause.Column{{Name: "song_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"pinned_kind", "updated_at"}),
		}
		if err := db.Clauses(upsert).Create(record).Error; err != nil {
			logrus.Errorf("save lyric pin for song %d failed: %v", id, err)
			return nil, errs.NewInternalServer("failed_to_update_target")
		}
	}
	previous, _ := loadLyricVersionRecord(ctx, id)
	version, svcerr := s.redecideLyricVersion(ctx, id)
	if svcerr != nil {
		return nil, svcerr
	}
	if version != nil && (previous == nil || previous.LyricHash != version.Hash) {
		// 没有配置大模型或不能生成标注的歌曲会返回错误，忽略
		_, _ = s.GetLyricAnnotations(ctx, id)
	}
	result := version.dto()
	return &result, nil
}

// SaveLyricOffset 保存一首歌某一歌词来源的整体偏移（仅管理员，由路由限制）；为 0 时删除记录
func (s *MusicService) SaveLyricOffset(ctx context.Context, id int64, source string, offsetMs int) *errs.ServiceError {
	if id <= 0 || !lyricSettingSources[source] || offsetMs < -lyricOffsetMaxMs || offsetMs > lyricOffsetMaxMs {
		return errs.NewBadRequest("invalid_request_parameters")
	}
	db := repo.GetDB().WithContext(ctx)
	if offsetMs == 0 {
		if err := db.Where("song_id = ? AND source = ?", id, source).Delete(&model.LyricSetting{}).Error; err != nil {
			return errs.NewInternalServer("failed_to_update_target")
		}
		return nil
	}
	record := &model.LyricSetting{SongID: id, Source: source, OffsetMs: offsetMs, UpdatedAt: time.Now()}
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "song_id"}, {Name: "source"}},
		DoUpdates: clause.AssignmentColumns([]string{"offset_ms", "updated_at"}),
	}
	if err := db.Clauses(upsert).Create(record).Error; err != nil {
		logrus.Errorf("save lyric offset for song %d failed: %v", id, err)
		return errs.NewInternalServer("failed_to_update_target")
	}
	return nil
}
