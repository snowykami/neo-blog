package repo

import (
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
)

type revisionRepo struct{}

var Revision = &revisionRepo{}

func (r *revisionRepo) Create(revision *model.ContentRevision) error {
	return GetDB().Create(revision).Error
}

// Latest 目标最新的一个版本（含正文），没有时返回 nil
func (r *revisionRepo) Latest(targetType string, targetID uint) (*model.ContentRevision, error) {
	var revisions []model.ContentRevision
	err := GetDB().Where("target_type = ? AND target_id = ?", targetType, targetID).
		Order("id DESC").Limit(1).Find(&revisions).Error
	if err != nil || len(revisions) == 0 {
		return nil, err
	}
	return &revisions[0], nil
}

// List 版本列表（不含正文与元信息），新的在前
func (r *revisionRepo) List(targetType string, targetID uint, pagination dto.PaginationParams) ([]model.ContentRevision, int64, error) {
	var revisions []model.ContentRevision
	var total int64
	query := GetDB().Model(&model.ContentRevision{}).Where("target_type = ? AND target_id = ?", targetType, targetID)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	size := int(pagination.Size)
	if size <= 0 || size > 100 {
		size = 50
	}
	page := int(pagination.Page)
	if page <= 0 {
		page = 1
	}
	err := query.Select("id", "created_at", "target_type", "target_id", "kind", "user_id", "api_token_id", "title", "word_count").
		Preload("User").Preload("APIToken").Order("id DESC").Offset((page - 1) * size).Limit(size).Find(&revisions).Error
	return revisions, total, err
}

// Get 指定目标下的某个版本（含正文）
func (r *revisionRepo) Get(targetType string, targetID, revisionID uint) (*model.ContentRevision, error) {
	var revision model.ContentRevision
	err := GetDB().Preload("User").Preload("APIToken").
		Where("id = ? AND target_type = ? AND target_id = ?", revisionID, targetType, targetID).
		First(&revision).Error
	return &revision, err
}

// Prune 每个目标只保留最近 keep 个非发布版本，发布版本永久保留
func (r *revisionRepo) Prune(targetType string, targetID uint, keep int) error {
	var ids []uint
	if err := GetDB().Model(&model.ContentRevision{}).
		Where("target_type = ? AND target_id = ? AND kind <> ?", targetType, targetID, "publish").
		Order("id DESC").Offset(keep).Pluck("id", &ids).Error; err != nil || len(ids) == 0 {
		return err
	}
	return GetDB().Where("id IN ?", ids).Delete(&model.ContentRevision{}).Error
}

// DeleteByTarget 删除目标的全部版本（文章 / 页面删除时）
func (r *revisionRepo) DeleteByTarget(targetType string, targetID uint) error {
	return GetDB().Where("target_type = ? AND target_id = ?", targetType, targetID).Delete(&model.ContentRevision{}).Error
}
