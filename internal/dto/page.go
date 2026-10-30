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
	Layout       string  `json:"layout"`     // 前台版式：reading 阅读（正文 + 目录侧边栏）/ wide 宽屏
	Kind         string  `json:"kind"`       // 页面类型：content 正文页面 / link 链接页面
	LinkURL      string  `json:"link_url"`   // 链接页面的地址：站内路径（/ 开头）或 http(s) 站外地址
	Fullscreen   bool    `json:"fullscreen"` // 全屏页面：顶栏收起为手势条
	// HTML 页面的显示尺寸：fill 占满导航栏以下的视口 / ratio 固定宽高比 / height 固定高度
	HTMLSizeMode    string `json:"html_size_mode"`
	HTMLAspectRatio string `json:"html_aspect_ratio"` // 固定宽高比，如 16:9
	HTMLHeight      int    `json:"html_height"`       // 固定高度（px）
}

type PageDto struct {
	ID     uint    `json:"id"`
	UserID uint    `json:"user_id"`
	User   UserDto `json:"user"`
	PageBaseDto
	HTMLBundle *PageHTMLBundleDto `json:"html_bundle,omitempty"` // HTML 页面当前生效的版本，仅单页详情返回，未上传时为空
	CreatedAt  time.Time          `json:"created_at"`
	UpdatedAt  time.Time          `json:"updated_at"`
}

type CreateOrUpdatePageReq struct {
	ID uint `path:"id" json:"id"`
	PageBaseDto
	// 以下字段覆盖 PageBaseDto 同名字段，用指针区分“未传”与“零值”，避免只保存草稿时把私密、导航设置重置
	IsPrivate  *bool   `json:"is_private"`
	ShowInNav  *bool   `json:"show_in_nav"`
	NavOrder   *int    `json:"nav_order"`
	Layout     *string `json:"layout"`
	Kind       *string `json:"kind"`
	LinkURL    *string `json:"link_url"`
	Fullscreen *bool   `json:"fullscreen"`
	// HTML 页面的显示尺寸
	HTMLSizeMode    *string `json:"html_size_mode"`
	HTMLAspectRatio *string `json:"html_aspect_ratio"`
	HTMLHeight      *int    `json:"html_height"`
	// 摘要、封面传空字符串表示清空，未传则保持原值
	Description *string `json:"description"`
	Cover       *string `json:"cover"`
	// 编辑会话ID，保存正文时校验，见 EditSessionService
	EditSessionID string `header:"X-Edit-Session" json:"-"`
}

type ListPageReq struct {
	Query     string `query:"query"`
	NoContent bool   `query:"no_content" default:"false"`
	OnlyNav   bool   `query:"only_nav" default:"false"`
	UserID    uint   `query:"user_id"`
	PaginationParams
}

// PageHTMLBundleDto HTML 页面当前生效版本的访问信息
type PageHTMLBundleDto struct {
	Version         int    `json:"version"`
	Entry           string `json:"entry"`
	URL             string `json:"url"`               // 入口文件地址：默认为站内相对路径，配置了独立源时为该源下的绝对地址
	AllowSameOrigin bool   `json:"allow_same_origin"` // 由独立的无 Cookie 源托管时为 true，iframe 可以放开 allow-same-origin
}

type PageHTMLFileDto struct {
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	MimeType string `json:"mime_type"`
}

// PageHTMLVersionDto HTML 页面的一个版本（仅管理员可见）
type PageHTMLVersionDto struct {
	ID         uint              `json:"id"`
	Version    int               `json:"version"`
	Entry      string            `json:"entry"`
	SourceName string            `json:"source_name"`
	TotalSize  int64             `json:"total_size"`
	Files      []PageHTMLFileDto `json:"files"`
	URL        string            `json:"url"`    // 入口文件地址，用于预览
	Active     bool              `json:"active"` // 是否为页面当前生效的版本
	// 由独立的无 Cookie 源托管时为 true，预览 iframe 可以放开 allow-same-origin
	AllowSameOrigin bool      `json:"allow_same_origin"`
	CreatedAt       time.Time `json:"created_at"`
}

type UploadPageHTMLReq struct {
	PageID uint   `path:"id"`
	Entry  string `form:"entry"` // 可选：指定入口文件，不传时自动选择 index.html
}

type ListPageHTMLVersionsReq struct {
	PageID uint `path:"id"`
}

// ServePageHTMLReq 访问 HTML 页面的静态文件：/page-html/{页面ID}/{版本标识}/{文件路径}
type ServePageHTMLReq struct {
	PageID uint   `path:"page_id"`
	Key    string `path:"key"`
	Path   string `path:"path"`
}

// UpdatePageHTMLVersionReq 修改版本的入口文件，或切换为页面当前生效的版本
type UpdatePageHTMLVersionReq struct {
	PageID    uint    `path:"id"`
	VersionID uint    `path:"vid"`
	Entry     *string `json:"entry"`
	Active    *bool   `json:"active"`
}
