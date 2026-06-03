package model

import (
	"github.com/snowykami/neo-blog/internal/dto"
	"gorm.io/gorm"
)

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
		},
		CreatedAt: p.CreatedAt,
		UpdatedAt: p.UpdatedAt,
	}
}

func (p *Page) ToDtoWithShortContent(contentLength int) *dto.PageDto {
	pageDto := p.ToDto()
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
