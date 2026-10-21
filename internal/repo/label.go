package repo

import (
	"sort"

	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
)

type labelRepo struct{}

var Label = &labelRepo{}

func (l *labelRepo) CreateLabel(label *model.Label) error {
	return GetDB().Create(label).Error
}

func (l *labelRepo) GetLabelByName(name string) (*model.Label, error) {
	var label model.Label
	if err := GetDB().Where("name = ?", name).First(&label).Error; err != nil {
		return nil, err
	}
	return &label, fillLabelPostCounts([]*model.Label{&label})
}

func (l *labelRepo) GetLabelByID(id uint) (*model.Label, error) {
	var label model.Label
	if err := GetDB().Where("id = ?", id).First(&label).Error; err != nil {
		return nil, err
	}
	return &label, fillLabelPostCounts([]*model.Label{&label})
}

// GetLabelsByIDs 批量查询标签，忽略不存在的 id
func (l *labelRepo) GetLabelsByIDs(ids []uint) ([]model.Label, error) {
	labels := make([]model.Label, 0, len(ids))
	if len(ids) == 0 {
		return labels, nil
	}
	err := GetDB().Where("id IN ?", ids).Find(&labels).Error
	return labels, err
}

// ListLabels 按公开文章数降序列出标签
func (l *labelRepo) ListLabels() ([]model.Label, error) {
	var labels []model.Label
	if err := GetDB().Order("id ASC").Find(&labels).Error; err != nil {
		return nil, err
	}
	ptrs := make([]*model.Label, len(labels))
	for i := range labels {
		ptrs[i] = &labels[i]
	}
	if err := fillLabelPostCounts(ptrs); err != nil {
		return nil, err
	}
	sort.SliceStable(labels, func(i, j int) bool { return labels[i].PostCount > labels[j].PostCount })
	return labels, nil
}

// fillLabelPostCounts 统计标签下的公开文章数，不加载文章本身
func fillLabelPostCounts(labels []*model.Label) error {
	ids := make([]uint, len(labels))
	for i, label := range labels {
		ids[i] = label.ID
	}
	counts, err := fetchLabelPostCounts(GetDB(), ids)
	if err != nil {
		return err
	}
	for _, label := range labels {
		label.PostCount = counts[label.ID]
	}
	return nil
}

func (l *labelRepo) UpdateLabel(label *model.Label) error {
	return GetDB().Updates(label).Error
}

// DeleteLabel 标签直接硬删除并解除文章关联，避免软删除记录占用唯一的 slug
func (l *labelRepo) DeleteLabel(id uint) error {
	return GetDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Table("post_labels").Where("label_id = ?", id).Delete(nil).Error; err != nil {
			return err
		}
		return tx.Unscoped().Where("id = ?", id).Delete(&model.Label{}).Error
	})
}

func (l *labelRepo) CountPostsByLabelID(id uint) (int64, error) {
	var count int64
	err := GetDB().Model(&model.Post{}).Joins("JOIN post_labels ON post_labels.post_id = posts.id").Where("post_labels.label_id = ?", id).Count(&count).Error
	return count, err
}
