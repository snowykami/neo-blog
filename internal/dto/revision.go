package dto

import "time"

// RevisionMeta 版本快照中的元信息；文章与页面共用，各自只使用相关字段
type RevisionMeta struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Cover       string `json:"cover"`
	// 文章专属背景图（版本快照里也保存，恢复时一并还原）
	BackgroundImage string  `json:"background_image,omitempty"`
	Slug            *string `json:"slug,omitempty"`
	IsPrivate       bool    `json:"is_private"`
	// 文章
	CategoryID *uint  `json:"category_id,omitempty"`
	LabelIds   []uint `json:"label_ids,omitempty"`
	Top        uint   `json:"top,omitempty"`
	// 页面
	ShowInNav  bool   `json:"show_in_nav,omitempty"`
	NavOrder   int    `json:"nav_order,omitempty"`
	Layout     string `json:"layout,omitempty"`
	Fullscreen *bool  `json:"fullscreen,omitempty"`
}

// RevisionDto 版本列表项（不含正文）
type RevisionDto struct {
	ID        uint      `json:"id"`
	Kind      string    `json:"kind"` // publish / session / autosave / backup
	Title     string    `json:"title"`
	WordCount int       `json:"word_count"`
	User      UserDto   `json:"user"`
	CreatedAt time.Time `json:"created_at"`
	// 通过个人 API Token（外部 AI 工具）写入时为 Token 名称
	APITokenName string `json:"api_token_name,omitempty"`
	// 受保护（不能删除、不会被自动清理）的原因：published 当前发布的版本 / latest 最新版本 / base 编辑起点；仅列表返回
	Protected string `json:"protected,omitempty"`
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
	MaxKeep   int            `json:"max_keep"` // 每篇最多保留的版本数，超出的旧版本自动清理
}

// RevisionTargetReq 版本相关接口的路径参数与编辑会话
type RevisionTargetReq struct {
	ID            uint   `path:"id"`
	RevisionID    uint   `path:"rid"`
	EditSessionID string `header:"X-Edit-Session"`
	PaginationParams
}

// BatchDeleteRevisionReq 批量删除版本
type BatchDeleteRevisionReq struct {
	ID            uint   `path:"id"`
	EditSessionID string `header:"X-Edit-Session"`
	RevisionIDs   []uint `json:"revision_ids"`
}

// DeleteRevisionResp 删除版本的结果
type DeleteRevisionResp struct {
	Deleted int64 `json:"deleted"` // 实际删除的数量（已不存在的版本不计入）
}
