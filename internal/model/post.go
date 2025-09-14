package model

import (
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/constant"
	"gorm.io/gorm"
)

type Post struct {
	gorm.Model
	UserID       uint     `gorm:"index"`                                                                // 发布者的用户ID
	User         User     `gorm:"foreignKey:UserID;references:ID"`                                      // 关联的用户
	Title        string   `gorm:"type:text;not null"`                                                   // 帖子标题
	Cover        string   `gorm:"type:text"`                                                            // 帖子封面图
	Content      string   `gorm:"type:text;not null"`                                                   // 帖子内容
	Type         string   `gorm:"type:text;default:markdown"`                                           // markdown类型，支持markdown或html或txt
	CategoryID   uint     `gorm:"index"`                                                                // 帖子分类ID
	Category     Category `gorm:"foreignKey:CategoryID;references:ID"`                                  // 关联的分类
	Labels       []Label  `gorm:"many2many:post_labels;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"` // 关联的标签
	IsOriginal   bool     `gorm:"default:true"`                                                         // 是否为原创帖子
	IsPrivate    bool     `gorm:"default:false"`
	LikeCount    uint64
	CommentCount uint64
	ViewCount    uint64
	Heat         uint64
}

// CalculateHeat 热度计算
func (p *Post) CalculateHeat() float64 {
	return float64(
		p.LikeCount*constant.HeatFactorLikeWeight +
			p.CommentCount*constant.HeatFactorCommentWeight +
			p.ViewCount*constant.HeatFactorViewWeight,
	)
}

func (p *Post) ToDto() *dto.PostDto {
	return &dto.PostDto{
		ID:         p.ID,
		UserID:     p.UserID,
		Title:      p.Title,
		Content:    p.Content,
		Cover:      p.Cover,
		Type:       p.Type,
		IsOriginal: p.IsOriginal,
		IsPrivate:  p.IsPrivate,
		Labels: func() []dto.LabelDto {
			labelDtos := make([]dto.LabelDto, len(p.Labels))
			for i, label := range p.Labels {
				labelDtos[i] = label.ToDto()
			}
			return labelDtos
		}(),
		LikeCount:    p.LikeCount,
		CommentCount: p.CommentCount,
		ViewCount:    p.ViewCount,
		Heat:         uint64(p.CalculateHeat()),
		CreatedAt:    p.CreatedAt,
		UpdatedAt:    p.UpdatedAt,
		User:         p.User.ToDto(),
	}
}

// ToDtoWithShortContent 返回一个简化的 DTO，内容可以根据需要截断
func (p *Post) ToDtoWithShortContent(contentLength int) *dto.PostDto {
	dtoPost := p.ToDto()
	if len(p.Content) > contentLength {
		dtoPost.Content = p.Content[:contentLength] + "..."
	} else {
		dtoPost.Content = p.Content
	}
	return dtoPost
}
