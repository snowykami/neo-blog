package dto

import "time"

type PageBaseDto struct {
	Title        string  `json:"title"`
	Slug         string  `json:"slug"`
	Description  string  `json:"description"`
	Cover        string  `json:"cover"`
	Content      string  `json:"content"`
	DraftContent *string `json:"draft_content"`
	Type         string  `json:"type"`
	IsPrivate    bool    `json:"is_private"`
	ShowInNav    bool    `json:"show_in_nav"`
	NavOrder     int     `json:"nav_order"`
}

type PageDto struct {
	ID     uint    `json:"id"`
	UserID uint    `json:"user_id"`
	User   UserDto `json:"user"`
	PageBaseDto
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type CreateOrUpdatePageReq struct {
	ID uint `path:"id" json:"id"`
	PageBaseDto
}

type ListPageReq struct {
	Query     string `query:"query"`
	NoContent bool   `query:"no_content" default:"false"`
	OnlyNav   bool   `query:"only_nav" default:"false"`
	UserID    uint   `query:"user_id"`
	PaginationParams
}
