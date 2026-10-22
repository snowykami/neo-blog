package dto

import "time"

type PostBaseDto struct {
	Title        string       `json:"title"`
	Description  string       `json:"description"`
	Slug         *string      `json:"slug"`
	Cover        string       `json:"cover"`
	Content      string       `json:"content"`
	DraftContent *string      `json:"draft_content"`
	Type         string       `json:"type"`
	Category     *CategoryDto `json:"category"`
	CategoryID   *uint        `json:"category_id"`
	Labels       []LabelDto   `json:"labels"`
	LabelIds     []uint       `json:"label_ids"`
	IsPrivate    bool         `json:"is_private"`
	Top          uint         `json:"top"` // 置顶级别，0表示不置顶，数值越大优先级越高
}

type PostDto struct {
	ID            uint      `json:"id"`            // 帖子ID
	UserID        uint      `json:"user_id"`       // 发布者的用户ID
	User          UserDto   `json:"user"`          // 发布者信息
	Collaborators []UserDto `json:"collaborators"` // 协作者列表
	PostBaseDto
	IsLiked      bool      `json:"is_liked"`      // 当前用户是否点赞
	LikeCount    uint64    `json:"like_count"`    // 点赞数
	CommentCount uint64    `json:"comment_count"` // 评论数
	ViewCount    uint64    `json:"view_count"`    // 浏览数
	Heat         uint64    `json:"heat"`          // 热度
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"` // 更新时间

}

type CreateOrUpdatePostReq struct {
	ID uint `path:"id" json:"id"` // 文章ID，更新时需要
	PostBaseDto
	// 以下字段覆盖 PostBaseDto 同名字段，用指针区分“未传”与“零值”，避免只保存草稿时把私密、置顶重置
	IsPrivate *bool `json:"is_private"`
	Top       *uint `json:"top"`
	// 编辑会话ID，保存正文时校验，见 EditSessionService
	EditSessionID string `header:"X-Edit-Session" json:"-"`
}

type ListPostReq struct {
	Query     string `query:"query"`                      // 搜索查询
	NoContent bool   `query:"no_content" default:"false"` // 是否不返回内容，用于只需要列表时
	PaginationParams
	Label    string `query:"label"`
	Category string `query:"category"`
	UserID   uint   `query:"user_id"` // 用户ID，管理员可查看指定用户的文章
}

type ListPostResp struct {
	Posts   []PostDto `json:"posts"`
	Total   uint64    `json:"total"`    // 总数
	OrderBy string    `json:"order_by"` // 排序方式
	Desc    bool      `json:"desc"`
}
