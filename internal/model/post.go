package model

import (
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
	"github.com/snowykami/neo-blog/pkg/utils"
	"gorm.io/gorm"
)

// TIPS: 每次增加新的可变字段请在更新逻辑中添加对应的空值检验
type PostBase struct {
	Category   *Category `gorm:"foreignKey:CategoryID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`
	CategoryID *uint     `gorm:"index"`
	Cover      string    `gorm:"type:text"`
	// BackgroundImage 文章专属的整页背景图；为空时沿用全站背景
	BackgroundImage string  `gorm:"type:text"`
	Content         string  `gorm:"type:text"`
	Description     string  `gorm:"type:text"`
	DraftContent    *string `gorm:"type:text"` // 草稿内容
	IsPrivate       bool    `gorm:"default:false"`
	Labels          []Label `gorm:"many2many:post_labels;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`
	Slug            *string `gorm:"type:text;index;uniqueIndex"` // 友好链接
	Title           string  `gorm:"type:text;not null"`
	Type            string  `gorm:"type:varchar(20);default:'html'"` // 文章类型，默认为 'markdown'，可为html或其他
	Top             uint    `gorm:"default:0;index"`                 // 置顶级别，0表示不置顶，数值越大优先级越高
}
type Post struct {
	gorm.Model
	UserID        uint   `gorm:"index"`                                                                       // 发布者的用户ID
	User          User   `gorm:"foreignKey:UserID;references:ID"`                                             // 关联的用户
	Collaborators []User `gorm:"many2many:post_collaborators;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"` // 协作者列表
	PostBase
	LikeCount    uint64
	CommentCount uint64
	ViewCount    uint64
	Heat         uint64
	// ContentHash 已发布正文的哈希，保存时自动计算，用于判断 AI 摘要是否过期
	ContentHash string `gorm:"type:varchar(64)"`
	// AI 摘要：最近一次生成的摘要文本、生成时依据的正文哈希与生成时间
	AISummary           string     `gorm:"column:ai_summary;type:text"`
	AISummarySourceHash string     `gorm:"column:ai_summary_source_hash;type:varchar(64)"`
	AISummaryAt         *time.Time `gorm:"column:ai_summary_at"`
}

// HashContent 计算正文哈希
func HashContent(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// BeforeSave 保存时同步正文哈希
func (p *Post) BeforeSave(tx *gorm.DB) error {
	p.ContentHash = HashContent(p.Content)
	return nil
}

// AISummaryStale 正文在生成摘要后又被修改过
func (p *Post) AISummaryStale() bool {
	return p.AISummarySourceHash != "" && p.ContentHash != "" && p.AISummarySourceHash != p.ContentHash
}

func (p *Post) ToDto() *dto.PostDto {
	return &dto.PostDto{
		ID:     p.ID,
		UserID: p.UserID,
		Collaborators: func() []dto.UserDto {
			collaboratorDtos := make([]dto.UserDto, len(p.Collaborators))
			for i, collaborator := range p.Collaborators {
				collaboratorDtos[i] = collaborator.ToDto()
			}
			return collaboratorDtos
		}(),
		PostBaseDto: dto.PostBaseDto{
			Title:           p.Title,
			Type:            p.Type,
			Slug:            utils.Ternary(p.Slug != nil, p.Slug, nil),
			Content:         p.Content,
			Cover:           p.Cover,
			BackgroundImage: p.BackgroundImage,
			Category: func() *dto.CategoryDto {
				if p.Category != nil {
					return p.Category.ToDto()
				}
				return nil
			}(),
			Description:  p.Description,
			DraftContent: p.DraftContent,
			IsPrivate:    p.IsPrivate,
			Top:          p.Top,
			Labels: func() []dto.LabelDto {
				labelDtos := make([]dto.LabelDto, len(p.Labels))
				for i, label := range p.Labels {
					labelDtos[i] = label.ToDto()
				}
				return labelDtos
			}(),
		},
		IsLiked:      false, // 默认未点赞，需在业务逻辑中设置
		LikeCount:    p.LikeCount,
		CommentCount: p.CommentCount,
		ViewCount:    p.ViewCount,
		Heat:         p.Heat,
		CreatedAt:    p.CreatedAt,
		UpdatedAt:    p.UpdatedAt,
		User:         p.User.ToDto(),
		// 摘要仍是 AI 生成的原文（未被手动修改）时，前台以「AI 摘要」样式展示
		DescriptionByAI: p.AISummary != "" && p.Description == p.AISummary,
		AISummaryStale:  p.AISummaryStale(),
		AISummaryAt:     p.AISummaryAt,
	}
}

// ToDtoWithShortContent 返回一个简化的 DTO，内容可以根据需要截断
func (p *Post) ToDtoWithShortContent(contentLength int) *dto.PostDto {
	dtoPost := p.ToDto()
	dtoPost.DraftContent = nil // 列表等公开场景不返回草稿内容
	if contentLength <= 0 {
		dtoPost.Content = ""
		return dtoPost
	}
	runes := []rune(p.Content)
	if len(runes) > contentLength {
		dtoPost.Content = string(runes[:contentLength]) + "..."
	} else {
		dtoPost.Content = p.Content
	}
	return dtoPost
}
