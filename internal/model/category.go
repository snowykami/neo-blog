package model

import "gorm.io/gorm"

type Category struct {
	gorm.Model
	Name        string `gorm:"type:text;not null"`
	Description string `gorm:"type:text;not null"` // 分类描述
}
