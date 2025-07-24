package model

import (
	"github.com/snowykami/neo-blog/internal/dto"
	"gorm.io/gorm"
)

type Label struct {
	gorm.Model
	Key               string `gorm:"uniqueIndex"`                                                          // 标签键，唯一标识
	Value             string `gorm:"type:text"`                                                            // 标签值，描述标签的内容
	Color             string `gorm:"type:text"`                                                            // 前端可用颜色代码
	TailwindClassName string `gorm:"type:text"`                                                            // Tailwind CSS 的类名，用于前端样式
	Posts             []Post `gorm:"many2many:post_labels;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"` // 关联的帖子
}

func (l *Label) ToDto() dto.LabelDto {
	return dto.LabelDto{
		Key:               l.Key,
		Value:             l.Value,
		Color:             l.Color,
		TailwindClassName: l.TailwindClassName,
	}
}
