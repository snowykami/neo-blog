package repo

import (
	"context"
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm/clause"
)

type musicMVSettingRepo struct{}

// MusicMVSetting 单曲 MV 人工设置仓储
var MusicMVSetting = &musicMVSettingRepo{}

// GetBySongID 查询单曲 MV 设置；未设置时返回 nil, nil
func (r *musicMVSettingRepo) GetBySongID(ctx context.Context, songID int64) (*model.MusicMVSetting, error) {
	d := DB(ctx)
	if d == nil {
		return nil, ErrDatabaseNotInitialized
	}
	var record model.MusicMVSetting
	if err := d.Where("song_id = ?", songID).Limit(1).Find(&record).Error; err != nil {
		return nil, err
	}
	if record.ID == 0 {
		return nil, nil
	}
	return &record, nil
}

// Save 按 song_id 唯一索引保存或更新单曲 MV 偏移与禁用状态
func (r *musicMVSettingRepo) Save(ctx context.Context, songID int64, offsetMs int, disabled bool) (*model.MusicMVSetting, error) {
	d := DB(ctx)
	if d == nil {
		return nil, ErrDatabaseNotInitialized
	}
	record := &model.MusicMVSetting{
		SongID:     songID,
		MVOffsetMs: offsetMs,
		MVDisabled: disabled,
		UpdatedAt:  time.Now(),
	}
	upsert := clause.OnConflict{
		Columns:   []clause.Column{{Name: "song_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"mv_offset_ms", "mv_disabled", "updated_at"}),
	}
	if err := d.Clauses(upsert).Create(record).Error; err != nil {
		return nil, err
	}
	return record, nil
}
