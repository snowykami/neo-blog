package model

import "gorm.io/gorm"

type Label struct {
	gorm.Model
	Key   string `gorm:"uniqueIndex"` // 标签键，唯一标识
	Value string `gorm:"type:text"`   // 标签值，描述标签的内容
	Color string `gorm:"type:text"`   // 前端可用颜色代码
}
