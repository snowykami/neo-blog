package model

import (
	"github.com/snowykami/neo-blog/internal/dto"
	"gorm.io/gorm"
)

type Label struct {
	gorm.Model
	Value             string `gorm:"type:text"`                                                            // 标签值，描述标签的内容
	TailwindClassName string `gorm:"type:text"`                                                            // Tailwind CSS 的类名，用于前端样式
	Posts             []Post `gorm:"many2many:post_labels;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"` // 关联的帖子
}

func (l *Label) ToDto() dto.LabelDto {
	return dto.LabelDto{
		Value:             l.Value,
		TailwindClassName: l.TailwindClassName,
	}
}
