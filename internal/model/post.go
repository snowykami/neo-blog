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
	// 文章专属背景，整体留空时沿用全站背景（见 dto.PostBackgroundDto）
	BackgroundImage     string  `gorm:"type:text"`        // 背景图地址
	BackgroundBlur      float64 `gorm:"default:0"`        // 高斯模糊，0-40 px
	BackgroundOpacity   float64 `gorm:"default:1"`        // 图片不透明度，0-1
	BackgroundVeil      float64 `gorm:"default:0.72"`     // 蒙版不透明度，0-1
	BackgroundVeilColor string  `gorm:"type:varchar(64)"` // 蒙版颜色，空表示跟随主题
	Content             string  `gorm:"type:text"`
	ContentTheme        string  `gorm:"type:varchar(32);default:''"` // 文章内容主题（正文排版），空表示跟随站点默认
	Description         string  `gorm:"type:text"`
	DraftContent        *string `gorm:"type:text"` // 草稿内容
	IsPrivate           bool    `gorm:"default:false"`
	IsDraft             bool    `gorm:"not null;default:false"` // 尚未首次发布的新文章，仅后台与预览可见
	Labels              []Label `gorm:"many2many:post_labels;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"`
	Slug                *string `gorm:"type:text;index;uniqueIndex"` // 友好链接
	Title               string  `gorm:"type:text;not null"`
	Type                string  `gorm:"type:varchar(20);default:'html'"` // 文章类型，默认为 'markdown'，可为html或其他
}
type Post struct {
	gorm.Model
	UserID        uint   `gorm:"index"`                                                                       // 发布者的用户ID
	User          User   `gorm:"foreignKey:UserID;references:ID"`                                             // 关联的用户
	Collaborators []User `gorm:"many2many:post_collaborators;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;"` // 协作者列表
	PostBase
	// 置顶到首页（只有管理员可以设置）：PinnedAt 为置顶时间，越晚越靠前；PinnedUntil 为到期时间，空表示不自动取消
	PinnedAt     *time.Time `gorm:"index"`
	PinnedUntil  *time.Time
	LikeCount    uint64
	CommentCount uint64
	ViewCount    uint64
	Heat         uint64
	// ContentHash 已发布正文的哈希，保存时自动计算，用于判断 AI 摘要是否过期
	ContentHash string `gorm:"type:varchar(64)"`
	// Excerpt 已发布正文的纯文本摘要（前 PostExcerptRunes 个字），保存时自动生成：
	// 列表只读这一列，不必为了摘要读出整篇正文，也不会出现截在标签中间的残缺 HTML
	Excerpt string `gorm:"type:text"`
	// AI 摘要：最近一次生成的摘要文本、生成时依据的正文哈希与生成时间
	AISummary           string     `gorm:"column:ai_summary;type:text"`
	AISummarySourceHash string     `gorm:"column:ai_summary_source_hash;type:varchar(64)"`
	AISummaryAt         *time.Time `gorm:"column:ai_summary_at"`
	// DraftVersion 草稿版本号：每次写入正文（保存草稿或发布）加一，保存时据此校验是否基于最新草稿，避免覆盖他人的修改
	DraftVersion uint64 `gorm:"not null;default:0"`
	// HasDraft 是否存在尚未发布的草稿改动，保存时自动计算，避免列表与仪表盘对比大文本列
	HasDraft bool `gorm:"not null;default:false"`
}

// IsPublic 文章是否已在前台公开可见（非私密且已完成首次发布）
func (p *Post) IsPublic() bool {
	return !p.IsPrivate && !p.IsDraft
}

// HashContent 计算正文哈希
func HashContent(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// PostExcerptRunes 文章纯文本摘要的最大字数（超出时另加省略号）
const PostExcerptRunes = 200

// PostExcerpt 由正文 HTML 生成纯文本摘要
func PostExcerpt(content string) string {
	return utils.HTMLExcerpt(content, PostExcerptRunes)
}

// BeforeSave 保存时同步正文哈希、纯文本摘要与草稿未发布状态
func (p *Post) BeforeSave(tx *gorm.DB) error {
	p.ContentHash = HashContent(p.Content)
	p.Excerpt = PostExcerpt(p.Content)
	p.HasDraft = p.DraftContent != nil && *p.DraftContent != "" && *p.DraftContent != p.Content
	return nil
}

// IsPinned 此刻是否置顶在首页：已置顶且没有到期
func (p *Post) IsPinned(now time.Time) bool {
	return p.PinnedAt != nil && (p.PinnedUntil == nil || p.PinnedUntil.After(now))
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
			Title:        p.Title,
			Type:         p.Type,
			Slug:         utils.Ternary(p.Slug != nil, p.Slug, nil),
			Content:      p.Content,
			ContentTheme: p.ContentTheme,
			Cover:        p.Cover,
			Background: dto.PostBackgroundDto{
				Image:     p.BackgroundImage,
				Blur:      p.BackgroundBlur,
				Opacity:   p.BackgroundOpacity,
				Veil:      p.BackgroundVeil,
				VeilColor: p.BackgroundVeilColor,
			},
			Category: func() *dto.CategoryDto {
				if p.Category != nil {
					return p.Category.ToDto()
				}
				return nil
			}(),
			Description:  p.Description,
			DraftContent: p.DraftContent,
			IsPrivate:    p.IsPrivate,
			IsDraft:      p.IsDraft,
			Labels: func() []dto.LabelDto {
				labelDtos := make([]dto.LabelDto, len(p.Labels))
				for i, label := range p.Labels {
					labelDtos[i] = label.ToDto()
				}
				return labelDtos
			}(),
		},
		HasDraft:     p.HasDraft || (p.DraftContent != nil && *p.DraftContent != "" && *p.DraftContent != p.Content),
		IsLiked:      false, // 默认未点赞，需在业务逻辑中设置
		Excerpt:      p.Excerpt,
		Pinned:       p.IsPinned(time.Now()),
		PinnedAt:     p.PinnedAt,
		PinnedUntil:  p.PinnedUntil,
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
		DraftVersion:    p.DraftVersion,
	}
}

// ToCardDto 正文「文章引用」卡片：只含卡片展示需要的字段，不含正文与草稿
func (p *Post) ToCardDto() dto.PostCardDto {
	card := dto.PostCardDto{
		ID:          p.ID,
		Slug:        p.Slug,
		Title:       p.Title,
		Description: p.Description,
		Cover:       p.Cover,
		Type:        p.Type,
		User:        p.User.ToDto(),
		LikeCount:   p.LikeCount,
		ViewCount:   p.ViewCount,
		CreatedAt:   p.CreatedAt,
		UpdatedAt:   p.UpdatedAt,
	}
	if p.Category != nil {
		card.Category = p.Category.ToDto()
	}
	return card
}

// ToDtoWithShortContent 返回一个简化的 DTO，内容可以根据需要截断
func (p *Post) ToDtoWithShortContent(contentLength int) *dto.PostDto {
	dtoPost := p.ToDto()
	dtoPost.DraftContent = nil // 列表等公开场景不返回草稿内容
	dtoPost.DraftVersion = 0
	dtoPost.HasDraft = false
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
