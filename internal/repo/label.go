package repo

import "github.com/snowykami/neo-blog/internal/model"

type labelRepo struct{}

var Label = &labelRepo{}

func (l *labelRepo) CreateLabel(label *model.Label) error {
	return GetDB().Create(label).Error
}

func (l *labelRepo) GetLabelByKey(key string) (*model.Label, error) {
	var label model.Label
	if err := GetDB().Where("key = ?", key).First(&label).Error; err != nil {
		return nil, err
	}
	return &label, nil
}

func (l *labelRepo) GetLabelByValue(value string) (*model.Label, error) {
	var label model.Label
	if err := GetDB().Where("value = ?", value).First(&label).Error; err != nil {
		return nil, err
	}
	return &label, nil
}

func (l *labelRepo) GetLabelByKeyAndValue(key, value string) (*model.Label, error) {
	var label model.Label
	query := GetDB().Where("key = ?", key)
	if value != "" {
		query = query.Where("value = ?", value)
	}
	if err := GetDB().Where(query).First(&label).Error; err != nil {
		return nil, err
	}
	return &label, nil
}

func (l *labelRepo) GetLabelByID(id string) (*model.Label, error) {
	var label model.Label
	if err := GetDB().Where("id = ?", id).First(&label).Error; err != nil {
		return nil, err
	}
	return &label, nil
}

func (l *labelRepo) ListLabels() ([]model.Label, error) {
	var labels []model.Label
	if err := GetDB().Find(&labels).Error; err != nil {
		return nil, err
	}
	return labels, nil
}

func (l *labelRepo) UpdateLabel(label *model.Label) error {
	if err := GetDB().Save(label).Error; err != nil {
		return err
	}
	return nil
}

func (l *labelRepo) DeleteLabel(id string) error {
	if err := GetDB().Where("id = ?", id).Delete(&model.Label{}).Error; err != nil {
		return err
	}
	return nil
}
