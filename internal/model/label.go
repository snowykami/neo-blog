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
		PostCount: int64(len(l.Posts)),
	}
}

// ToLabelDtos converts a slice of Label models to a slice of LabelDto orderby postCount desc
func ToLabelDtos(labels []Label) []dto.LabelDto {
	labelDtos := make([]dto.LabelDto, len(labels))
	for i, label := range labels {
		labelDtos[i] = label.ToDto()
	}
	return labelDtos
}
