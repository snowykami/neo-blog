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

// 歌词的人工设置（见 docs/music-player-spec.md 7.2l）：目前只有整体偏移。管理员在播放器里微调后保存，
// 所有人播放这首歌（同一歌词来源）时都按它显示；不同来源的时间轴不同，按来源分别保存

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
	return result, nil
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
