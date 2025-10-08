package repo

import "github.com/snowykami/neo-blog/internal/model"

type labelRepo struct{}

var Label = &labelRepo{}

func (l *labelRepo) CreateLabel(label *model.Label) error {
	return GetDB().Create(label).Error
}

func (l *labelRepo) GetLabelByName(name string) (*model.Label, error) {
	var label model.Label
	if err := GetDB().Preload("Posts").Where("name = ?", name).First(&label).Error; err != nil {
		return nil, err
	}
	return &label, nil
}

func (l *labelRepo) GetLabelByID(id uint) (*model.Label, error) {
	var label model.Label
	if err := GetDB().Preload("Posts").Where("id = ?", id).First(&label).Error; err != nil {
		return nil, err
	}
	return &label, nil
}

func (l *labelRepo) ListLabels() ([]model.Label, error) {
	var labels []model.Label
	db := GetDB().
		Model(&model.Label{}).
		Preload("Posts").
		Joins("LEFT JOIN post_labels ON post_labels.label_id = labels.id").
		Group("labels.id").
		Order("COUNT(post_labels.post_id) DESC")

	if err := db.Find(&labels).Error; err != nil {
		return nil, err
	}
	return labels, nil
}

func (l *labelRepo) UpdateLabel(label *model.Label) error {
	return GetDB().Updates(label).Error
}

func (l *labelRepo) DeleteLabel(id uint) error {
	return GetDB().Where("id = ?", id).Delete(&model.Label{}).Error
}

func (l *labelRepo) CountPostsByLabelID(id uint) (int64, error) {
	var count int64
	err := GetDB().Model(&model.Post{}).Joins("JOIN post_labels ON post_labels.post_id = posts.id").Where("post_labels.label_id = ?", id).Count(&count).Error
	return count, err
}
