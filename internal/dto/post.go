package dto

type PostDto struct {
	ID           uint       `json:"id"`      // 帖子ID
	UserID       uint       `json:"user_id"` // 发布者的用户ID
	Title        string     `json:"title"`   // 帖子标题
	Content      string     `json:"content"`
	Labels       []LabelDto `json:"labels"`        // 关联的标签
	IsPrivate    bool       `json:"is_private"`    // 是否为私密帖子
	LikeCount    uint64     `json:"like_count"`    // 点赞数
	CommentCount uint64     `json:"comment_count"` // 评论数
	ViewCount    uint64     `json:"view_count"`    // 浏览数
	Heat         uint64     `json:"heat"`          // 热度
}

type CreateOrUpdatePostReq struct {
	Title     string `json:"title"`
	Content   string `json:"content"`
	IsPrivate bool   `json:"is_private"`
	Labels    []uint `json:"labels"` // 标签ID列表
}

type ListPostReq struct {
	Keywords  []string `json:"keywords"`   // 关键词列表
	OrderedBy string   `json:"ordered_by"` // 排序方式
	Page      uint64   `json:"page"`       // 页码
	Size      uint64   `json:"size"`
	Reverse   bool     `json:"reverse"`
}

type ListPostResp struct {
	Posts     []PostDto `json:"posts"`
	Total     uint64    `json:"total"`      // 总数
	OrderedBy string    `json:"ordered_by"` // 排序方式
	Reverse   bool      `json:"reverse"`
}
