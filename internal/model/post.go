package model

import (
	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/constant"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

// 每次增加新的可变字段请在更新逻辑中添加对应的空值检验
type PostBase struct {
	Category    *Category `gorm:"foreignKey:CategoryID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`
	CategoryID  *uint     `gorm:"index"`
	Cover       string    `gorm:"type:text"`
	Content     string    `gorm:"type:text;not null"`
	Description string    `gorm:"type:text"`
	IsPrivate   bool      `gorm:"default:false"`
	Labels      []Label   `gorm:"many2many:post_labels;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`
	Slug        *string   `gorm:"type:text;index;uniqueIndex"` // 改为指针并加 uniqueIndex
	Title       string    `gorm:"type:text;not null"`
}
type Post struct {
	gorm.Model
	UserID uint `gorm:"index"`                           // 发布者的用户ID
	User   User `gorm:"foreignKey:UserID;references:ID"` // 关联的用户
	// core fields
	PostBase
	//
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
		ID:     p.ID,
		UserID: p.UserID,
		PostBaseDto: dto.PostBaseDto{
			Title:       p.Title,
			Description: p.Description,
			Slug:        utils.Ternary(p.Slug == nil, p.Slug, nil),
			Content:     p.Content,
			Cover:       p.Cover,
			Category: func() *dto.CategoryDto {
				if p.Category != nil {
					return p.Category.ToDto()
				}
				return nil
			}(),
			IsPrivate: p.IsPrivate,
			Labels: func() []dto.LabelDto {
				labelDtos := make([]dto.LabelDto, len(p.Labels))
				for i, label := range p.Labels {
					labelDtos[i] = label.ToDto()
				}
				return labelDtos
			}(),
		},
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

// Draft 草稿
type Draft struct {
	gorm.Model
	PostID uint `gorm:"uniqueIndex"` // 关联的文章ID
	Post   Post `gorm:"foreignKey:PostID;references:ID"`
	PostBase
}

func (d *Draft) ToDto() *dto.DraftDto {
	return &dto.DraftDto{
		PostID: d.PostID,
		PostBaseDto: dto.PostBaseDto{
			Title:       d.Title,
			Description: d.Description,
			Slug:        utils.Ternary(d.Slug == nil, d.Slug, nil),
			Content:     d.Content,
			Cover:       d.Cover,
			Category: func() *dto.CategoryDto {
				if d.Category != nil {
					return d.Category.ToDto()
				}
				return nil
			}(),
			IsPrivate: d.IsPrivate,
			Labels: func() []dto.LabelDto {
				labelDtos := make([]dto.LabelDto, len(d.Labels))
				for i, label := range d.Labels {
					labelDtos[i] = label.ToDto()
				}
				return labelDtos
			}(),
		},
	}
}
