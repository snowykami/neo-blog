package model

import "gorm.io/gorm"

type File struct {
	gorm.Model
	ID     uint   `gorm:"primaryKey"` // 文件ID File ID
	Hash   string `gorm:"not null"`   // 文件哈希值 File hash
	UserID uint   `gorm:"not null"`   // 上传者ID Uploader ID
	Group  string // 分组名称
	Name   string // 文件名，为空显示未hash
}
