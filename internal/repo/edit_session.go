package repo

import (
	"time"

	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm/clause"
)

type editSessionRepo struct{}

var EditSession = &editSessionRepo{}

// Upsert 写入编辑会话，同一目标已有会话时直接覆盖（顶掉旧会话）
func (e *editSessionRepo) Upsert(session *model.EditSession) error {
	return GetDB().Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "target_type"}, {Name: "target_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"session_id", "user_id", "user_agent", "updated_at", "api_token_id", "active_at", "base_revision_id"}),
	}).Create(session).Error
}

// SetBaseRevision 记录会话的编辑起点版本；会话已被顶掉时不修改
func (e *editSessionRepo) SetBaseRevision(targetType string, targetID uint, sessionID string, revisionID uint) error {
	return GetDB().Model(&model.EditSession{}).
		Where("target_type = ? AND target_id = ? AND session_id = ?", targetType, targetID, sessionID).
		UpdateColumn("base_revision_id", revisionID).Error
}

// Get 获取目标当前的编辑会话（包含用户信息）
func (e *editSessionRepo) Get(targetType string, targetID uint) (*model.EditSession, error) {
	var session model.EditSession
	if err := GetDB().Preload("User").Preload("APIToken").Where("target_type = ? AND target_id = ?", targetType, targetID).First(&session).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

// TouchActive 刷新会话的最近活跃时间，距上次记录不足 interval 时不写库
func (e *editSessionRepo) TouchActive(targetType string, targetID uint, sessionID string, now time.Time, interval time.Duration) error {
	return GetDB().Model(&model.EditSession{}).
		Where("target_type = ? AND target_id = ? AND session_id = ?", targetType, targetID, sessionID).
		Where("active_at IS NULL OR active_at < ?", now.Add(-interval)).
		UpdateColumn("active_at", now).Error
}

// GetTargetOwnerID 获取文章/页面的作者ID，仅查询作者字段，不影响浏览量等统计
func (e *editSessionRepo) GetTargetOwnerID(targetType string, targetID uint) (uint, error) {
	var ownerID uint
	var target any
	switch targetType {
	case constant.TargetTypePost:
		target = &model.Post{}
	case constant.TargetTypePage:
		target = &model.Page{}
	default:
		return 0, errs.NewBadRequest("invalid_request_parameters")
	}
	if err := GetDB().Model(target).Where("id = ?", targetID).Select("user_id").Scan(&ownerID).Error; err != nil {
		return 0, err
	}
	return ownerID, nil
}
