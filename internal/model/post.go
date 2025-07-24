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
	Type         string   `gorm:"type:text;default:markdown"`                                           // markdown类型，支持markdown或html
	CategoryID   uint     `gorm:"index"`                                                                // 帖子分类ID
	Category     Category `gorm:"foreignKey:CategoryID;references:ID"`                                  // 关联的分类
	Labels       []Label  `gorm:"many2many:post_labels;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"` // 关联的标签
	IsPrivate    bool     `gorm:"default:false"`                                                        // 是否为私密帖子
	LikeCount    uint64
	CommentCount uint64
	ViewCount    uint64
	Heat         uint64 `gorm:"default:0"`
}

// CalculateHeat 热度计算
func (p *Post) CalculateHeat() float64 {
	return float64(
		p.LikeCount*constant.HeatFactorLikeWeight +
			p.CommentCount*constant.HeatFactorCommentWeight +
			p.ViewCount*constant.HeatFactorViewWeight,
	)
}

// AfterUpdate 热度指标更新后更新热度
func (p *Post) AfterUpdate(tx *gorm.DB) (err error) {
	if tx.Statement.Changed("LikeCount") || tx.Statement.Changed("CommentCount") || tx.Statement.Changed("ViewCount") {
		p.Heat = uint64(p.CalculateHeat())
		if err := tx.Model(p).Update("heat", p.Heat).Error; err != nil {
			return err
		}
	}
	return nil
}

func (p *Post) ToDto() dto.PostDto {
	return dto.PostDto{
		ID:           p.ID,
		UserID:       p.UserID,
		Title:        p.Title,
		Content:      p.Content,
		Cover:        p.Cover,
		Type:         p.Type,
		IsPrivate:    p.IsPrivate,
		LikeCount:    p.LikeCount,
		CommentCount: p.CommentCount,
		ViewCount:    p.ViewCount,
		Heat:         p.Heat,
		CreatedAt:    p.CreatedAt,
		UpdatedAt:    p.UpdatedAt,
	}
}
