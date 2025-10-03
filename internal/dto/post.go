package dto

import "time"

type PostBaseDto struct {
	Title       string       `json:"title"`
	Description string       `json:"description"`
	Slug        *string      `json:"slug"`
	Cover       string       `json:"cover"`
	Content     string       `json:"content"`
	Type        string       `json:"type"`
	Category    *CategoryDto `json:"category"`
	Labels      []LabelDto   `json:"labels"`
	IsOriginal  bool         `json:"is_original"`
	IsPrivate   bool         `json:"is_private"`
}

type PostDto struct {
	ID     uint    `json:"id"`      // 帖子ID
	UserID uint    `json:"user_id"` // 发布者的用户ID
	User   UserDto `json:"user"`    // 发布者信息
	PostBaseDto
	LikeCount    uint64    `json:"like_count"`    // 点赞数
	CommentCount uint64    `json:"comment_count"` // 评论数
	ViewCount    uint64    `json:"view_count"`    // 浏览数
	Heat         uint64    `json:"heat"`          // 热度
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"` // 更新时间
}

type DraftDto struct {
	PostID uint `json:"post_id"` // 关联的帖子ID，如果有的话
	PostBaseDto
}

type CreateOrUpdatePostOrDraftReq struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Slug        *string `json:"slug"`
	Content     string  `json:"content"`
	CategoryID  *uint   `json:"category_id"`
	Cover       string  `json:"cover"`
	IsPrivate   bool    `json:"is_private"`
	IsOriginal  bool    `json:"is_original"`
	Type        string  `json:"type"`
	Labels      []uint  `json:"labels"` // 标签ID列表
}

type ListPostReq struct {
	Keywords string `query:"keywords"` // 关键词列表
	PaginationParams
	Label string `query:"label"`
}

type ListPostResp struct {
	Posts   []PostDto `json:"posts"`
	Total   uint64    `json:"total"`    // 总数
	OrderBy string    `json:"order_by"` // 排序方式
	Desc    bool      `json:"desc"`
}
