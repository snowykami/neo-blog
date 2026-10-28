package model

import (
	"github.com/snowykami/neo-blog/internal/dto"
	"gorm.io/gorm"
)

// 独立页面的前台版式
const (
	PageLayoutReading = "reading"
	PageLayoutWide    = "wide"
)

// NormalizePageLayout 未设置或不认识的版式按阅读版式处理
func NormalizePageLayout(layout string) string {
	if layout == PageLayoutWide {
		return PageLayoutWide
	}
	return PageLayoutReading
}

// 页面类型：content 为正文页面（默认，用编辑器撰写）；link 为链接页面，在导航中直接跳转到站内路径或站外地址
const (
	PageKindContent = "content"
	PageKindLink    = "link"
)

// NormalizePageKind 未设置或不认识的类型按正文页面处理
func NormalizePageKind(kind string) string {
	if kind == PageKindLink {
		return PageKindLink
	}
	return PageKindContent
}

type Page struct {
	gorm.Model
	UserID uint `gorm:"index"`
	User   User `gorm:"foreignKey:UserID;references:ID"`
	PageBase
}

type PageBase struct {
	Title        string  `gorm:"type:text;not null"`
	Slug         string  `gorm:"type:text;not null;uniqueIndex"`
	Description  string  `gorm:"type:text"`
	Cover        string  `gorm:"type:text"`
	Content      string  `gorm:"type:text"`
	DraftContent *string `gorm:"type:text"`
	Type         string  `gorm:"type:varchar(20);default:'html'"`
	IsPrivate    bool    `gorm:"default:false"`
	ShowInNav    bool    `gorm:"default:false;index"`
	NavOrder     int     `gorm:"default:0;index"`
	// 前台版式：reading 正文 + 目录侧边栏（默认），wide 正文占满整行
	Layout string `gorm:"type:varchar(20);default:'reading'"`
	// 页面类型与链接地址（仅链接页面）
	Kind    string `gorm:"type:varchar(16);default:'content'"`
	LinkURL string `gorm:"type:text"`
	// 全屏页面：正文占满视口，顶栏收起为顶部的手势条
	Fullscreen bool `gorm:"default:false"`
}

func (p *Page) ToDto() *dto.PageDto {
	return &dto.PageDto{
		ID:     p.ID,
		UserID: p.UserID,
		User:   p.User.ToDto(),
		PageBaseDto: dto.PageBaseDto{
			Title:        p.Title,
			Slug:         p.Slug,
			Description:  p.Description,
			Cover:        p.Cover,
			Content:      p.Content,
			DraftContent: p.DraftContent,
			Type:         p.Type,
			IsPrivate:    p.IsPrivate,
			ShowInNav:    p.ShowInNav,
			NavOrder:     p.NavOrder,
			Layout:       NormalizePageLayout(p.Layout),
			Kind:         NormalizePageKind(p.Kind),
			LinkURL:      p.LinkURL,
			Fullscreen:   p.Fullscreen,
		},
		CreatedAt: p.CreatedAt,
		UpdatedAt: p.UpdatedAt,
	}
}

func (p *Page) ToDtoWithShortContent(contentLength int) *dto.PageDto {
	pageDto := p.ToDto()
	pageDto.DraftContent = nil // 列表等公开场景不返回草稿内容
	if contentLength <= 0 {
		pageDto.Content = ""
		return pageDto
	}
	runes := []rune(p.Content)
	if len(runes) > contentLength {
		pageDto.Content = string(runes[:contentLength]) + "..."
	} else {
		pageDto.Content = p.Content
	}
	return pageDto
}
