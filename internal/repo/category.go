package repo

import (
	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
)

type categoryRepo struct{}

var Category = &categoryRepo{}

func (c *categoryRepo) GetByID(id uint) (*model.Category, error) {
	var category model.Category
	if err := GetDB().Where("id = ?", id).First(&category).Error; err != nil {
		return nil, err
	}
	return &category, nil
}

func (c *categoryRepo) Create(category *model.Category) error {
	return GetDB().Create(category).Error
}

// Update 只更新非零字段（与原接口行为一致）
func (c *categoryRepo) Update(category *model.Category) error {
	return GetDB().Updates(category).Error
}

// Delete 分类硬删除并清空文章的分类引用，避免软删除记录占用唯一的名称与 slug
func (c *categoryRepo) Delete(id uint) error {
	return GetDB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.Post{}).Where("category_id = ?", id).UpdateColumn("category_id", nil).Error; err != nil {
			return err
		}
		return tx.Unscoped().Delete(&model.Category{}, id).Error
	})
}

// SlugTakenByOther slug 是否已被其他分类占用（写入冲突时区分是名称还是 slug 重复）
func (c *categoryRepo) SlugTakenByOther(slug string, id uint) (bool, error) {
	var count int64
	err := GetDB().Model(&model.Category{}).Where("slug = ? AND id <> ?", slug, id).Count(&count).Error
	return count > 0, err
}
