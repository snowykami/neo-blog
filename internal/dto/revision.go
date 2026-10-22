package dto

import "time"

// RevisionMeta 版本快照中的元信息；文章与页面共用，各自只使用相关字段
type RevisionMeta struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Cover       string  `json:"cover"`
	Slug        *string `json:"slug,omitempty"`
	IsPrivate   bool    `json:"is_private"`
	// 文章
	CategoryID *uint  `json:"category_id,omitempty"`
	LabelIds   []uint `json:"label_ids,omitempty"`
	Top        uint   `json:"top,omitempty"`
	// 页面
	ShowInNav bool `json:"show_in_nav,omitempty"`
	NavOrder  int  `json:"nav_order,omitempty"`
}

// RevisionDto 版本列表项（不含正文）
type RevisionDto struct {
	ID        uint      `json:"id"`
	Kind      string    `json:"kind"` // publish / session / autosave / backup
	Title     string    `json:"title"`
	WordCount int       `json:"word_count"`
	User      UserDto   `json:"user"`
	CreatedAt time.Time `json:"created_at"`
}

// RevisionDetailDto 版本详情：含正文与元信息
type RevisionDetailDto struct {
	RevisionDto
	Content string       `json:"content"`
	Meta    RevisionMeta `json:"meta"`
}

type ListRevisionResp struct {
	Revisions []*RevisionDto `json:"revisions"`
	Total     int64          `json:"total"`
}

// RevisionTargetReq 版本相关接口的路径参数与编辑会话
type RevisionTargetReq struct {
	ID            uint   `path:"id"`
	RevisionID    uint   `path:"rid"`
	EditSessionID string `header:"X-Edit-Session"`
	PaginationParams
}
