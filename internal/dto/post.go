package dto

import "time"

// PostBackgroundDto 文章专属背景：整段留空（image 与 veil_color 都为空）时沿用全站背景。
// 字段含义与站点配置的 PageBackground 一致，前端可以直接交给背景层使用。
type PostBackgroundDto struct {
	Image     string  `json:"image"`      // 背景图地址
	Blur      float64 `json:"blur"`       // 高斯模糊，0-40 px
	Opacity   float64 `json:"opacity"`    // 图片不透明度，0-1
	Veil      float64 `json:"veil"`       // 蒙版不透明度，0-1；无背景图时即纯色背景的不透明度
	VeilColor string  `json:"veil_color"` // 蒙版颜色，空表示跟随主题
}

type PostBaseDto struct {
	Title        string            `json:"title"`
	Description  string            `json:"description"`
	Slug         *string           `json:"slug"`
	Cover        string            `json:"cover"`
	Background   PostBackgroundDto `json:"background"`
	Content      string            `json:"content"`
	ContentTheme string            `json:"content_theme"` // 文章内容主题（正文排版），空表示跟随站点默认
	DraftContent *string           `json:"draft_content"`
	Type         string            `json:"type"`
	Category     *CategoryDto      `json:"category"`
	CategoryID   *uint             `json:"category_id"`
	Labels       []LabelDto        `json:"labels"`
	LabelIds     []uint            `json:"label_ids"`
	IsPrivate    bool              `json:"is_private"`
	IsDraft      bool              `json:"is_draft"`
}

type PostDto struct {
	ID            uint            `json:"id"`            // 帖子ID
	UserID        uint            `json:"user_id"`       // 发布者的用户ID
	User          UserDto         `json:"user"`          // 发布者信息
	Collaborators []PublicUserDto `json:"collaborators"` // 协作者列表（仅公开字段）
	PostBaseDto
	HasDraft bool `json:"has_draft,omitempty"` // 后台列表提示是否存在未发布的草稿改动
	IsLiked  bool `json:"is_liked"`            // 当前用户是否点赞
	// Excerpt 已发布正文的纯文本摘要（最多 200 字，截断时带省略号）：列表不返回正文，摘要与 meta description 用它
	Excerpt string `json:"excerpt"`
	// 搜索命中增强（仅在前台关键词检索命中 Meilisearch 时返回）：裁剪后的命中上下文片段与实际命中的原文词
	SearchSnippet  string   `json:"search_snippet,omitempty"`
	HighlightTerms []string `json:"highlight_terms,omitempty"`
	// 置顶到首页：Pinned 为此刻是否置顶（已置顶且未到期）；PinnedUntil 为空表示不自动取消
	Pinned       bool       `json:"pinned"`
	PinnedAt     *time.Time `json:"pinned_at"`
	PinnedUntil  *time.Time `json:"pinned_until"`
	LikeCount    uint64     `json:"like_count"`    // 点赞数
	CommentCount uint64     `json:"comment_count"` // 评论数
	ViewCount    uint64     `json:"view_count"`    // 浏览数
	Heat         uint64     `json:"heat"`          // 热度
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"` // 更新时间
	// AI 摘要相关
	DescriptionByAI bool       `json:"description_by_ai"`           // 当前摘要由 AI 生成且未被修改
	AISummaryStale  bool       `json:"ai_summary_stale"`            // 正文在生成摘要后有更新，建议重新生成
	AISummaryAt     *time.Time `json:"ai_summary_at,omitempty"`     // 摘要生成时间
	AISummaryStatus string     `json:"ai_summary_status,omitempty"` // 生成任务状态：running / failed
	AISummaryError  string     `json:"ai_summary_error,omitempty"`  // 最近一次生成失败的原因
	// 草稿版本号，只随草稿一起返回给作者与管理员；保存正文时作为 base_draft_version 传回
	DraftVersion uint64 `json:"draft_version,omitempty"`
}

// PostStatsDto 文章的计数：前台页面缓存的是快照，浏览器进入文章页后用它补上最新值
type PostStatsDto struct {
	ViewCount    uint64 `json:"view_count"`
	LikeCount    uint64 `json:"like_count"`
	CommentCount uint64 `json:"comment_count"`
}

// AISummaryStatusDto AI 摘要生成任务状态
type AISummaryStatusDto struct {
	Status string `json:"status"` // idle / queued / running / succeeded / failed
	Error  string `json:"error,omitempty"`
	// VisionFallback 开启了识图但模型拒收图片（或已知不支持），本次按纯文本生成
	VisionFallback bool       `json:"vision_fallback,omitempty"`
	Description    string     `json:"description,omitempty"`
	Stale          bool       `json:"stale"`
	GeneratedAt    *time.Time `json:"generated_at,omitempty"`
	Configured     bool       `json:"configured"` // 是否已在全局配置中配置 AI
}

// BatchAISummaryReq 全站 AI 摘要
type BatchAISummaryReq struct {
	OverwriteManual bool `json:"overwrite_manual"` // 是否覆盖手动填写的描述，默认跳过
}

// BatchAISummaryResultDto 全站 AI 摘要的入队结果
type BatchAISummaryResultDto struct {
	Queued          int `json:"queued"`             // 本次加入队列的文章数
	SkippedUpToDate int `json:"skipped_up_to_date"` // 摘要已是最新
	SkippedManual   int `json:"skipped_manual"`     // 描述为手动填写
	SkippedEmpty    int `json:"skipped_empty"`      // 正文为空
	SkippedRunning  int `json:"skipped_running"`    // 已有任务在排队或生成中
}

type CreateOrUpdatePostReq struct {
	ID uint `path:"id" json:"id"` // 文章ID，更新时需要
	PostBaseDto
	// 以下字段覆盖 PostBaseDto 同名字段，用指针区分“未传”与“零值”，避免只保存草稿时把私密重置
	IsPrivate *bool `json:"is_private"`
	// 摘要、封面传空字符串表示清空，未传则保持原值
	Description *string `json:"description"`
	Cover       *string `json:"cover"`
	// 封面传空字符串表示清空；背景整段覆盖，未传（nil）表示不修改
	Background *PostBackgroundDto `json:"background"`
	// 内容主题传空字符串表示跟随站点默认，未传则保持原值
	ContentTheme *string `json:"content_theme"`
	// 编辑会话ID，保存正文时校验，见 EditSessionService
	EditSessionID string `header:"X-Edit-Session" json:"-"`
	// 本次修改所基于的草稿版本号：保存正文时与当前版本不一致（期间有其他写入）则拒绝，未传时不校验
	BaseDraftVersion *uint64 `json:"base_draft_version"`
}

// ContentSaveResult 保存文章 / 页面的结果，DraftVersion 为保存后的草稿版本号
type ContentSaveResult struct {
	ID           uint   `json:"id"`
	DraftVersion uint64 `json:"draft_version"`
}

type ListPostReq struct {
	Query     string `query:"query"`                      // 搜索查询
	NoContent bool   `query:"no_content" default:"false"` // 是否不返回内容，用于只需要列表时
	PaginationParams
	Label    string `query:"label"`
	Category string `query:"category"`
	UserID   uint   `query:"user_id"` // 用户ID，管理员可查看指定用户的文章
	// WithPinned 首页列表：没有任何筛选时另外返回置顶文章，并从列表中排除它们（置顶不占分页名额、不重复出现）；有筛选时忽略
	WithPinned bool `query:"with_pinned"`
}

// HomeListing 是否为首页的默认列表（请求了置顶且没有搜索、标签、分类、作者筛选），只有这时置顶才生效
func (r *ListPostReq) HomeListing() bool {
	return r.WithPinned && r.Query == "" && r.Label == "" && r.Category == "" && r.UserID == 0
}

type ListPostResp struct {
	Posts   []PostDto `json:"posts"`
	Total   uint64    `json:"total"`    // 总数
	OrderBy string    `json:"order_by"` // 排序方式
	Desc    bool      `json:"desc"`
}

// PostCardReq 正文「文章引用」卡片的批量查询，ids 为逗号分隔的文章 ID
// 一篇正文可能引用多篇文章，前端合并成一次请求，避免每张卡片各取一次
type PostCardReq struct {
	IDs string `query:"ids"` // 文章 ID，逗号分隔
}

// PostCardDto 正文「文章引用」卡片所需的数据：不含正文、草稿与背景，
// 避免为了一张卡片读出整篇文章；不可见或已删除的文章不会出现在结果里
type PostCardDto struct {
	ID          uint         `json:"id"`
	Slug        *string      `json:"slug"`
	Title       string       `json:"title"`
	Description string       `json:"description"`
	Cover       string       `json:"cover"`
	Type        string       `json:"type"`
	Category    *CategoryDto `json:"category"`
	User        UserDto      `json:"user"`
	LikeCount   uint64       `json:"like_count"`
	ViewCount   uint64       `json:"view_count"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
}

// SetPostPinReq 置顶到首页或取消置顶（仅管理员）
type SetPostPinReq struct {
	ID          uint       `path:"id" json:"-"`
	Pinned      bool       `json:"pinned"`
	PinnedUntil *time.Time `json:"pinned_until"` // 到期时间，空表示不自动取消；只在置顶时使用
}

// BatchDeletePostReq 批量删除文章
type BatchDeletePostReq struct {
	IDs []uint `json:"ids"`
}

// BatchPostVisibilityReq 批量设置文章私密/公开状态
type BatchPostVisibilityReq struct {
	IDs       []uint `json:"ids"`
	IsPrivate bool   `json:"is_private"`
}

// PostNeighborItemDto 文章底部的上下篇与相关阅读卡片项（仅含公开展示字段，不含正文与草稿）
type PostNeighborItemDto struct {
	ID          uint         `json:"id"`
	Slug        *string      `json:"slug"`
	Title       string       `json:"title"`
	Description string       `json:"description"`
	Excerpt     string       `json:"excerpt"`
	Cover       string       `json:"cover"`
	Category    *CategoryDto `json:"category"`
	CreatedAt   time.Time    `json:"created_at"`
}

// PostNeighborsResp 文章底部的连续阅读响应：上一篇、下一篇与相关推荐
type PostNeighborsResp struct {
	Prev    *PostNeighborItemDto  `json:"prev"`
	Next    *PostNeighborItemDto  `json:"next"`
	Related []PostNeighborItemDto `json:"related"`
}
