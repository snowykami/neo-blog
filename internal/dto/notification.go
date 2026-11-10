package dto

import "time"

// NotificationItemDto 通知列表里的一行：普通通知是它自己，点赞类是多条明细在渲染时归并的一行
type NotificationItemDto struct {
	ID    uint    `json:"id"`   // 代表行的 id，单条已读时用它；聚合行点开即整组已读
	Type  string  `json:"type"` // 见 constant.NotificationType*
	Actor UserDto `json:"actor"`
	// ActorIsAI 前端给 AI 用户加一个小徽标
	ActorIsAI bool `json:"actor_is_ai"`
	// ActorNames 聚合行里最新的两个昵称（点赞类），单条通知为空
	ActorNames []string `json:"actor_names,omitempty"`
	// AggregateCount 组内条数：1 表示单条，> 1 表示聚合行
	AggregateCount uint64 `json:"aggregate_count"`

	SubjectType  string `json:"subject_type"` // post / page
	SubjectID    uint   `json:"subject_id"`
	SubjectTitle string `json:"subject_title"`
	SubjectSlug  string `json:"subject_slug"`
	// TargetType post / comment：被互动的对象，用于深链与筛选
	TargetType string `json:"target_type"`
	TargetID   uint   `json:"target_id"`
	// CommentID 本次评论（评论 / 回复类）或线程根评论（线程活动类），用于 ?comment= 深链
	CommentID     uint   `json:"comment_id"`
	Excerpt       string `json:"excerpt"`        // 本次评论正文，前端按纯文本截断
	QuotedExcerpt string `json:"quoted_excerpt"` // 被回复 / 被点赞的那条评论正文

	IsRead    bool      `json:"is_read"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	// ActivityAt 最近一次活动时间：列表按它排序与分天，折叠行有新回复时会刷新
	ActivityAt time.Time `json:"activity_at"`
}

// ListNotificationsReq 通知列表查询参数；type 支持逗号分隔的多个事件类型（前端 tab 用）
type ListNotificationsReq struct {
	PaginationParams
	Filter string `query:"filter" default:"all"` // all / unread
	Type   string `query:"type"`
}

// NotificationUnreadCountDto 未读徽标：总数与分类型都是「聚合组」的数量
type NotificationUnreadCountDto struct {
	Total  int64            `json:"total"`
	ByType map[string]int64 `json:"by_type"`
	// LatestID / LatestAt 最近一条通知（按最近活动时间）：前端在它变新时提示「来了新通知」。
	// 未读组数不变的情况（点赞并入已有未读组、折叠行有新回复）只靠组数是看不出来的
	LatestID uint       `json:"latest_id"`
	LatestAt *time.Time `json:"latest_at"`
}

// MarkAllNotificationsReadReq 一键已读；before_id 避免把请求期间新到的通知也标掉
type MarkAllNotificationsReadReq struct {
	BeforeID *uint `json:"before_id"`
}

// NotificationPreferencesDto 通知偏好；站点级字段用于前端隐藏站点没开放的类型（用户只能关不能开）
type NotificationPreferencesDto struct {
	InApp          []string `json:"inapp"`
	Email          []string `json:"email"`
	AIInteractions bool     `json:"ai_interactions"`
	// SiteEmailEnabled 站点是否开启了通知邮件
	SiteEmailEnabled bool `json:"site_email_enabled"`
	// SiteEmailTypes 站点允许触发邮件的类型，即用户可选的上限
	SiteEmailTypes []string `json:"site_email_types"`
	// AvailableTypes 站内通知支持的全部类型，前端按分组渲染开关
	AvailableTypes []string `json:"available_types"`
}

// UpdateNotificationPreferencesReq 保存通知偏好；未传 ai_interactions 时保持原值
type UpdateNotificationPreferencesReq struct {
	InApp          []string `json:"inapp"`
	Email          []string `json:"email"`
	AIInteractions *bool    `json:"ai_interactions"`
}

// NotificationDeliveryDto 后台投递排查面板的一行
type NotificationDeliveryDto struct {
	ID           uint       `json:"id"`
	UserID       uint       `json:"user_id"`
	UserEmail    string     `json:"user_email"`
	Type         string     `json:"type"`
	SubjectTitle string     `json:"subject_title"`
	EmailState   string     `json:"email_state"`
	Attempts     int        `json:"attempts"`
	NextAt       *time.Time `json:"next_at"`
	LastError    string     `json:"last_error"`
	CreatedAt    time.Time  `json:"created_at"`
}

// ListNotificationDeliveriesReq 投递排查查询参数
type ListNotificationDeliveriesReq struct {
	PaginationParams
	State string `query:"state"` // failed / sending / pending / sent / skipped，空为「需要关注」
}
