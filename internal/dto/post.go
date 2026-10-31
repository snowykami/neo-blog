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
	DraftContent *string           `json:"draft_content"`
	Type         string            `json:"type"`
	Category     *CategoryDto      `json:"category"`
	CategoryID   *uint             `json:"category_id"`
	Labels       []LabelDto        `json:"labels"`
	LabelIds     []uint            `json:"label_ids"`
	IsPrivate    bool              `json:"is_private"`
	Top          uint              `json:"top"` // 置顶级别，0表示不置顶，数值越大优先级越高
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
	// AI 摘要相关
	DescriptionByAI bool       `json:"description_by_ai"`           // 当前摘要由 AI 生成且未被修改
	AISummaryStale  bool       `json:"ai_summary_stale"`            // 正文在生成摘要后有更新，建议重新生成
	AISummaryAt     *time.Time `json:"ai_summary_at,omitempty"`     // 摘要生成时间
	AISummaryStatus string     `json:"ai_summary_status,omitempty"` // 生成任务状态：running / failed
	AISummaryError  string     `json:"ai_summary_error,omitempty"`  // 最近一次生成失败的原因
}

// AISummaryStatusDto AI 摘要生成任务状态
type AISummaryStatusDto struct {
	Status      string     `json:"status"` // idle / queued / running / succeeded / failed
	Error       string     `json:"error,omitempty"`
	Description string     `json:"description,omitempty"`
	Stale       bool       `json:"stale"`
	GeneratedAt *time.Time `json:"generated_at,omitempty"`
	Configured  bool       `json:"configured"` // 是否已在全局配置中配置 AI
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
	// 以下字段覆盖 PostBaseDto 同名字段，用指针区分“未传”与“零值”，避免只保存草稿时把私密、置顶重置
	IsPrivate *bool `json:"is_private"`
	Top       *uint `json:"top"`
	// 摘要、封面传空字符串表示清空，未传则保持原值
	Description *string `json:"description"`
	Cover       *string `json:"cover"`
	// 封面传空字符串表示清空；背景整段覆盖，未传（nil）表示不修改
	Background *PostBackgroundDto `json:"background"`
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
