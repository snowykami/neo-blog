package repo

import (
	"slices"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
)

type revisionRepo struct{}

var Revision = &revisionRepo{}

// revisionDeleteChunk 按 ID 删除时每条语句的 ID 数，避免超出数据库的参数个数上限
const revisionDeleteChunk = 500

// RevisionTarget 拥有版本的目标（文章 / 页面）
type RevisionTarget struct {
	TargetType string
	TargetID   uint
}

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

// LatestID 目标最新版本的 ID，kind 非空时只看该类型的版本；没有时返回 0
func (r *revisionRepo) LatestID(targetType string, targetID uint, kind string) (uint, error) {
	var ids []uint
	query := GetDB().Model(&model.ContentRevision{}).Where("target_type = ? AND target_id = ?", targetType, targetID)
	if kind != "" {
		query = query.Where("kind = ?", kind)
	}
	if err := query.Order("id DESC").Limit(1).Pluck("id", &ids).Error; err != nil || len(ids) == 0 {
		return 0, err
	}
	return ids[0], nil
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

// Prune 每个目标只保留最新的 keep 个版本，keepIDs 中的版本无论新旧都保留；返回删除的数量
func (r *revisionRepo) Prune(targetType string, targetID uint, keep int, keepIDs []uint) (int64, error) {
	var ids []uint
	if err := GetDB().Model(&model.ContentRevision{}).
		Where("target_type = ? AND target_id = ?", targetType, targetID).
		Order("id DESC").Offset(keep).Pluck("id", &ids).Error; err != nil {
		return 0, err
	}
	ids = slices.DeleteFunc(ids, func(id uint) bool { return slices.Contains(keepIDs, id) })
	return r.DeleteByIDs(targetType, targetID, ids)
}

// DeleteByIDs 删除目标下的指定版本，返回删除的数量；不属于该目标的 ID 不会被删除
func (r *revisionRepo) DeleteByIDs(targetType string, targetID uint, ids []uint) (int64, error) {
	var deleted int64
	for chunk := range slices.Chunk(ids, revisionDeleteChunk) {
		result := GetDB().Where("target_type = ? AND target_id = ? AND id IN ?", targetType, targetID, chunk).
			Delete(&model.ContentRevision{})
		if result.Error != nil {
			return deleted, result.Error
		}
		deleted += result.RowsAffected
	}
	return deleted, nil
}

// TargetsOverLimit 版本数超过 keep 的目标
func (r *revisionRepo) TargetsOverLimit(keep int) ([]RevisionTarget, error) {
	var targets []RevisionTarget
	err := GetDB().Model(&model.ContentRevision{}).Select("target_type", "target_id").
		Group("target_type, target_id").Having("COUNT(*) > ?", keep).Scan(&targets).Error
	return targets, err
}

// DeleteByTarget 删除目标的全部版本（文章 / 页面删除时）
func (r *revisionRepo) DeleteByTarget(targetType string, targetID uint) error {
	return GetDB().Where("target_type = ? AND target_id = ?", targetType, targetID).Delete(&model.ContentRevision{}).Error
}
