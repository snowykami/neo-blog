package dto

import "time"

// DashboardReq 后台首页统计区间
type DashboardReq struct {
	Days int `query:"days"` // 统计最近多少天（含今天），仅支持 7 / 30，其他值按 7 处理
}

// DashboardDto 后台首页：累计数据、区间趋势与环比、内容状态和最近动态
type DashboardDto struct {
	// 累计数据
	TotalPosts    int64 `json:"total_posts"`
	TotalUsers    int64 `json:"total_users"`
	TotalComments int64 `json:"total_comments"`
	TotalViews    int64 `json:"total_views"` // 文章累计浏览量（posts.view_count 之和）
	TotalFiles    int64 `json:"total_files"`

	Days    int                   `json:"days"`
	Summary DashboardSummaryDto   `json:"summary"`
	Trend   []DashboardTrendPoint `json:"trend"`
	Content DashboardContentDto   `json:"content"`
	Sources []VisitSourceCount    `json:"sources"` // 区间内访问来源排行（不含站内跳转）
	Posts   DashboardPostListsDto `json:"posts"`
	// 最新评论（含回复），附带所在文章/页面与是否待回复
	RecentComments []DashboardCommentDto `json:"recent_comments"`
}

// DashboardMetric 本期与上期（紧邻的同长度区间）的数值，用于计算环比
type DashboardMetric struct {
	Current  int64 `json:"current"`
	Previous int64 `json:"previous"`
}

type DashboardSummaryDto struct {
	PV       DashboardMetric `json:"pv"`       // 访问次数
	UV       DashboardMetric `json:"uv"`       // 独立访客数（按访客去重）
	Comments DashboardMetric `json:"comments"` // 新增评论（含回复）
	Likes    DashboardMetric `json:"likes"`    // 新增点赞（文章与评论）
	NewUsers DashboardMetric `json:"new_users"`
	// 区间内待回复的根评论：没有任何回复，且不是文章/页面作者自己发的
	PendingComments int64 `json:"pending_comments"`
}

// DashboardTrendPoint 按服务器时区的自然日统计
type DashboardTrendPoint struct {
	Date     string `json:"date"` // YYYY-MM-DD
	PV       int64  `json:"pv"`
	UV       int64  `json:"uv"`
	Comments int64  `json:"comments"`
	Likes    int64  `json:"likes"`
}

type DashboardContentDto struct {
	Posts        int64 `json:"posts"`
	PublicPosts  int64 `json:"public_posts"`
	PrivatePosts int64 `json:"private_posts"`
	// 有尚未发布的修改（草稿内容与已发布正文不同）
	DraftPosts int64 `json:"draft_posts"`
	Pages      int64 `json:"pages"`
	// AI 摘要：已生成且与正文一致 / 正文修改后已过期 / 尚未生成
	AISummaryReady   int64 `json:"ai_summary_ready"`
	AISummaryStale   int64 `json:"ai_summary_stale"`
	AISummaryMissing int64 `json:"ai_summary_missing"`
}

type DashboardPostListsDto struct {
	Top     []DashboardPostDto `json:"top"`     // 区间内浏览最多
	Hot     []DashboardPostDto `json:"hot"`     // 累计热度最高
	Recent  []DashboardPostDto `json:"recent"`  // 最近发布
	Updated []DashboardPostDto `json:"updated"` // 最近更新
}

// DashboardPostDto 首页列表用的文章摘要，不含正文
type DashboardPostDto struct {
	ID           uint      `json:"id"`
	Title        string    `json:"title"`
	Slug         *string   `json:"slug"`
	IsPrivate    bool      `json:"is_private"`
	HasDraft     bool      `json:"has_draft"` // 有尚未发布的修改
	ViewCount    int64     `json:"view_count"`
	LikeCount    int64     `json:"like_count"`
	CommentCount int64     `json:"comment_count"`
	Heat         int64     `json:"heat"`
	PeriodViews  int64     `json:"period_views"` // 区间内访问次数，仅 top 列表有值
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type DashboardCommentDto struct {
	ID         uint              `json:"id"`
	Content    string            `json:"content"` // 截断后的评论内容
	User       *UserDto          `json:"user"`
	Target     *CommentTargetDto `json:"target"` // 所在文章/页面，已删除时为空
	Depth      int               `json:"depth"`
	ReplyCount int64             `json:"reply_count"`
	IsPrivate  bool              `json:"is_private"`
	Pending    bool              `json:"pending"` // 待回复，规则同 DashboardSummaryDto.PendingComments
	CreatedAt  time.Time         `json:"created_at"`
}
