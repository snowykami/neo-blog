package model

import "gorm.io/gorm"

type Label struct {
	gorm.Model
	Key               string `gorm:"uniqueIndex"` // 标签键，唯一标识
	Value             string `gorm:"type:text"`   // 标签值，描述标签的内容
	Color             string `gorm:"type:text"`   // 前端可用颜色代码
	TailwindClassName string `gorm:"type:text"`   // Tailwind CSS 的类名，用于前端样式
}
