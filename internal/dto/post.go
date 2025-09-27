package dto

import "time"

type PostDto struct {
	ID           uint       `json:"id"`      // 帖子ID
	UserID       uint       `json:"user_id"` // 发布者的用户ID
	User         UserDto    `json:"user"`    // 发布者信息
	Slug         string     `json:"slug"`    // 帖子别名
	Title        string     `json:"title"`   // 帖子标题
	Content      string     `json:"content"`
	Cover        string     `json:"cover"`         // 帖子封面图
	Type         string     `json:"type"`          // 帖子类型 markdown / html / text
	Labels       []LabelDto `json:"labels"`        // 关联的标签
	IsOriginal   bool       `json:"is_original"`   // 是否为原创帖子
	IsPrivate    bool       `json:"is_private"`    // 是否为私密帖子
	LikeCount    uint64     `json:"like_count"`    // 点赞数
	CommentCount uint64     `json:"comment_count"` // 评论数
	ViewCount    uint64     `json:"view_count"`    // 浏览数
	Heat         uint64     `json:"heat"`          // 热度
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"` // 更新时间
}

type CreateOrUpdatePostReq struct {
	Title     string  `json:"title"`
	Slug      *string `json:"slug"`
	Content   string  `json:"content"`
	Cover     string  `json:"cover"`
	IsPrivate bool    `json:"is_private"`
	Type      string  `json:"type"`
	Labels    []uint  `json:"labels"` // 标签ID列表
}

type ListPostReq struct {
	PaginationParams
	Keywords string `query:"keywords"` // 关键词列表
	Label    string `query:"label"`    // 单个标签过滤
}

type ListPostResp struct {
	Posts   []PostDto `json:"posts"`
	Total   uint64    `json:"total"`    // 总数
	OrderBy string    `json:"order_by"` // 排序方式
	Desc    bool      `json:"desc"`
}
