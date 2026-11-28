package dto

// MisskeyFeedQueryReq 前台侧边栏动态列表分页查询参数（纯只读切片，不触发上游同步请求）
type MisskeyFeedQueryReq struct {
	Offset int    `query:"offset"`
	Limit  int    `query:"limit"`
	Cursor string `query:"cursor"`
}

// MisskeyUserDto 侧边栏 Misskey 用户公开摘要（不含敏感信息）
type MisskeyUserDto struct {
	Username   string `json:"username"`
	Name       string `json:"name"`
	AvatarURL  string `json:"avatar_url"`
	ProfileURL string `json:"profile_url"`
}

// MisskeyNoteImageDto 帖子公开图片缩略图（仅保留 http/https 且非敏感图片）
type MisskeyNoteImageDto struct {
	ThumbnailURL string `json:"thumbnail_url"`
	Alt          string `json:"alt"`
}

// MisskeyQuoteDto 带评论引用转发（Quote Renote）的内嵌原帖摘要（严格遵循 CW 折叠与公开可见性过滤）
type MisskeyQuoteDto struct {
	Username string `json:"username,omitempty"`
	Name     string `json:"name,omitempty"`
	Text     string `json:"text,omitempty"`
	CW       string `json:"cw,omitempty"`
	HasMedia bool   `json:"has_media,omitempty"`
	URL      string `json:"url,omitempty"`
}

// MisskeyNoteDto 经过严格可见性过滤与 MFM 纯文本脱敏后的单条公开动态
type MisskeyNoteDto struct {
	ID             string                `json:"id"`
	URL            string                `json:"url"`
	Text           string                `json:"text"`
	CW             string                `json:"cw,omitempty"`
	CreatedAt      string                `json:"created_at"`
	IsRenote       bool                  `json:"is_renote,omitempty"`
	RenoteUser     string                `json:"renote_user,omitempty"`
	Quote          *MisskeyQuoteDto      `json:"quote,omitempty"`
	Images         []MisskeyNoteImageDto `json:"images,omitempty"`
	ReactionsCount int                   `json:"reactions_count,omitempty"`
	RepliesCount   int                   `json:"replies_count,omitempty"`
	RenotesCount   int                   `json:"renotes_count,omitempty"`
}

// MisskeyFeedDto 前台公开只读 Misskey 动态响应（物理隔离 API Token 与内部哈希）
type MisskeyFeedDto struct {
	Enabled     bool             `json:"enabled"`
	FetchedAt   string           `json:"fetched_at,omitempty"`
	InstanceURL string           `json:"instance_url,omitempty"`
	User        *MisskeyUserDto  `json:"user,omitempty"`
	Notes       []MisskeyNoteDto `json:"notes"`
	Total       int              `json:"total"`
	HasMore     bool             `json:"has_more"`
	NextCursor  string           `json:"next_cursor,omitempty"`
}
