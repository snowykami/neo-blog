package repo

import (
	"strings"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/internal/model"
	"github.com/snowykami/neo-blog/pkg/errs"
	"gorm.io/gorm"
)

type FileRepo struct{}

var File = &FileRepo{}

func (f *FileRepo) Create(file *model.File) (err error) {
	return GetDB().Create(file).Error
}

func (f *FileRepo) GetByHash(hash string) (model.File, error) {
	var file model.File
	return file, GetDB().Where("hash = ?", hash).First(&file).Error
}

func (f *FileRepo) GetByID(id uint) (model.File, *errs.ServiceError) {
	var file model.File
	if err := GetDB().Where("id = ?", id).First(&file).Error; err != nil {
		return file, errs.NewNotFound("failed_to_get_target")
	}
	return file, nil
}

func (f *FileRepo) DeleteByID(id uint) error {
	return GetDB().Where("id = ?", id).Delete(&model.File{}).Error
}

func (f *FileRepo) ListFiles(userID uint, paginationParams *dto.PaginationParams, keywords []string) ([]model.File, int64, error) {
	var files []model.File
	var total int64
	// 构建基础查询
	query := GetDB().Model(&model.File{})
	// 应用筛选条件
	if userID != 0 {
		query = query.Where("user_id = ?", userID)
	}
	if len(keywords) > 0 {
		query = query.Where("name LIKE ?", "%"+strings.Join(keywords, "%")+"%")
	}
	// 先获取总数
	countQuery := query.Session(&gorm.Session{}) // 创建新的会话，避免影响原查询
	if err := countQuery.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	// 应用分页和排序
	if paginationParams != nil {
		query = query.Offset(int(paginationParams.Offset())).
			Limit(int(paginationParams.Size)).
			Order(paginationParams.Order())
	}
	// 查询数据
	if err := query.Find(&files).Error; err != nil {
		return nil, 0, err
	}
	return files, total, nil
}

func (f *FileRepo) ListStorageProviders() (providers []model.StorageProviderModelAndDto, err error) {
	err = GetDB().Find(&providers).Error
	return
}

func (f *FileRepo) SetDefaultStorageProvider(id uint) error {
	return GetDB().Model(&model.StorageProviderModelAndDto{}).Where("id = ?", id).Update("is_default", true).Error
}

func (f *FileRepo) UnsetDefaultStorageProvider(id uint) *errs.ServiceError {
	if err := GetDB().Model(&model.StorageProviderModelAndDto{}).Where("id = ?", id).Update("is_default", false).Error; err != nil {
		return errs.NewInternalServer("failed_to_update_target")
	}
	return nil
}

func (f *FileRepo) CreateStorageProvider(provider *model.StorageProviderModelAndDto) *errs.ServiceError {
	if provider.IsDefault {
		// 创建默认存储提供者时，先将其他提供者的默认状态取消
		if err := GetDB().Model(&model.StorageProviderModelAndDto{}).Where("is_default = ?", true).Update("is_default", false).Error; err != nil {
			return errs.NewInternalServer("failed_to_create_target")
		}
	}
	if err := GetDB().Create(provider).Error; err != nil {
		return errs.NewInternalServer("failed_to_create_target")
	}
	return nil
}

func (f *FileRepo) UpdateStorageProvider(id uint, provider *model.StorageProviderModelAndDto) *errs.ServiceError {
	if provider.IsDefault {
		if err := GetDB().Model(&model.StorageProviderModelAndDto{}).Where("is_default = ?", true).Update("is_default", false).Error; err != nil {
			return errs.NewInternalServer("failed_to_update_target")
		}
	}
	if err := GetDB().Model(&model.StorageProviderModelAndDto{}).Where("id = ?", id).Updates(provider).Error; err != nil {
		return errs.NewInternalServer("failed_to_update_target")
	}
	return nil
}

func (f *FileRepo) DeleteStorageProvider(id uint) *errs.ServiceError {
	if err := GetDB().Where("id = ?", id).Delete(&model.StorageProviderModelAndDto{}).Error; err != nil {
		return errs.NewInternalServer("failed_to_delete_target")
	}
	return nil
}
