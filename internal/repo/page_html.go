package repo

import (
	"github.com/snowykami/neo-blog/internal/model"
	"gorm.io/gorm"
)

type pageHTMLRepo struct{}

var PageHTML = &pageHTMLRepo{}

func (p *pageHTMLRepo) Create(version *model.PageHTMLVersion) error {
	return GetDB().Create(version).Error
}

func (p *pageHTMLRepo) GetByID(id uint) (*model.PageHTMLVersion, error) {
	var version model.PageHTMLVersion
	if err := GetDB().First(&version, id).Error; err != nil {
		return nil, err
	}
	return &version, nil
}

func (p *pageHTMLRepo) GetByKey(key string) (*model.PageHTMLVersion, error) {
	var version model.PageHTMLVersion
	if key == "" {
		return nil, gorm.ErrRecordNotFound // 结构体条件会忽略零值，空 key 必须提前拦截
	}
	// 用结构体条件让 GORM 为 key 列名加引号（key 在部分数据库中是关键字）
	if err := GetDB().Where(&model.PageHTMLVersion{Key: key}).First(&version).Error; err != nil {
		return nil, err
	}
	return &version, nil
}

// ListByPage 页面的全部版本，新版本在前
func (p *pageHTMLRepo) ListByPage(pageID uint) ([]model.PageHTMLVersion, error) {
	var versions []model.PageHTMLVersion
	err := GetDB().Where("page_id = ?", pageID).Order("version DESC").Find(&versions).Error
	return versions, err
}

// MaxVersion 页面已有的最大版本号，没有版本时为 0
func (p *pageHTMLRepo) MaxVersion(pageID uint) (int, error) {
	var maxVersion int
	err := GetDB().Model(&model.PageHTMLVersion{}).Where("page_id = ?", pageID).
		Select("COALESCE(MAX(version), 0)").Scan(&maxVersion).Error
	return maxVersion, err
}

func (p *pageHTMLRepo) UpdateEntry(id uint, entry string) error {
	return GetDB().Model(&model.PageHTMLVersion{}).Where("id = ?", id).Update("entry", entry).Error
}

// DeleteByID 存储中的文件随之删除，记录不保留软删除
func (p *pageHTMLRepo) DeleteByID(id uint) error {
	return GetDB().Unscoped().Delete(&model.PageHTMLVersion{}, id).Error
}
