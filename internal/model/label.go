package model

import (
	"github.com/snowykami/neo-blog/internal/dto"
	"gorm.io/gorm"
)

type Label struct {
	gorm.Model
	Name              string `gorm:"type:text"`                                                            // 标签值，描述标签的内容
	Slug              string `gorm:"type:text;uniqueIndex"`                                                // 标签别名，URL友好
	TailwindClassName string `gorm:"type:text"`                                                            // Tailwind CSS 的类名，用于前端样式
	Posts             []Post `gorm:"many2many:post_labels;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"` // 关联的帖子
}

func (l *Label) ToDto() dto.LabelDto {
	return dto.LabelDto{
		ID: l.ID,
		LabelBase: dto.LabelBase{
			Name:              l.Name,
			TailwindClassName: l.TailwindClassName,
			Slug:              l.Slug,
		},
	}
}
