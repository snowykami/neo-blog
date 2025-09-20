package repo

import "github.com/snowykami/neo-blog/internal/model"

type FileRepo struct{}

var File = &FileRepo{}

func (f *FileRepo) Create(file *model.File) (err error) {
	return GetDB().Create(file).Error
}

func (f *FileRepo) GetByHash(hash string) (file model.File, err error) {
	err = GetDB().Where("hash = ?", hash).First(&file).Error
	return
}

func (f *FileRepo) GetByID(id uint) (file model.File, err error) {
	err = GetDB().Where("id = ?", id).First(&file).Error
	return
}
