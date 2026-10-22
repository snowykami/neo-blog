package dto

import "time"

// ReportVisitReq 浏览器上报一次访问
type ReportVisitReq struct {
	Path        string `json:"path"`
	TargetType  string `json:"target_type"` // post / page / other
	TargetID    uint   `json:"target_id"`
	Referrer    string `json:"referrer"`
	Fingerprint string `json:"fingerprint"` // 前端计算的浏览器指纹哈希
}

type ListVisitLogReq struct {
	PaginationParams
	Kind       string `query:"kind"`   // all / user / anonymous
	Action     string `query:"action"` // 空为全部；visit 仅访问；interaction 仅互动
	VisitorID  uint   `query:"visitor_id"`
	TargetType string `query:"target_type"`
	TargetID   uint   `query:"target_id"`
	Source     string `query:"source"`      // 按来源筛选
	SourceHost string `query:"source_host"` // 来源为其他网站时按域名筛选
}

type VisitorDto struct {
	ID          uint      `json:"id"`
	User        *UserDto  `json:"user"`
	IP          string    `json:"ip"` // 已脱敏
	Location    string    `json:"location"`
	OS          string    `json:"os"`
	Browser     string    `json:"browser"`
	DeviceType  string    `json:"device_type"`
	VisitCount  int64     `json:"visit_count"`
	FirstSeenAt time.Time `json:"first_seen_at"`
	LastSeenAt  time.Time `json:"last_seen_at"`
}

type VisitLogDto struct {
	ID         uint     `json:"id"`
	VisitorID  *uint    `json:"visitor_id"`
	VisitCount int64    `json:"visit_count"` // 该访客的累计访问次数
	User       *UserDto `json:"user"`        // 访问者或执行互动的用户
	Action     string   `json:"action"`      // visit / like / comment
	TargetType string   `json:"target_type"` // 访问：post / page / other；互动：post / page / comment
	TargetID   uint     `json:"target_id"`
	TargetUser *UserDto `json:"target_user"` // 被互动内容的作者
	// 所在的文章或页面（目标为评论时为评论所在的文章/页面），已删除时为空
	Subject *CommentTargetDto `json:"subject"`
	// 被点赞或被回复的评论，已删除时为空
	TargetComment *VisitCommentDto `json:"target_comment"`
	// 评论/回复时新发表的评论，已删除时为空
	Comment *VisitCommentDto `json:"comment"`
	// 其他页面的路由类型与名称（如标签名、分类名、用户昵称），见 service.describeVisitPath
	PathKind   string    `json:"path_kind"`
	PathName   string    `json:"path_name"`
	Path       string    `json:"path"`
	Referrer   string    `json:"referrer"`
	Source     string    `json:"source"`      // 来源分类，见 utils.ClassifyReferrer
	SourceHost string    `json:"source_host"` // 来源域名，直接访问时为空
	IP         string    `json:"ip"`          // 已脱敏
	Location   string    `json:"location"`
	OS         string    `json:"os"`
	Browser    string    `json:"browser"`
	DeviceType string    `json:"device_type"`
	CreatedAt  time.Time `json:"created_at"`
}

// VisitCommentDto 互动记录中涉及的评论摘要
type VisitCommentDto struct {
	ID      uint   `json:"id"`
	Content string `json:"content"` // 截断后的评论内容
}

type VisitStatsDto struct {
	TodayPV         int64 `json:"today_pv"`
	TodayUV         int64 `json:"today_uv"`
	TodayUserVisits int64 `json:"today_user_visits"`
	TotalVisitors   int64 `json:"total_visitors"`
	// 今日访问来源排行（不含站内跳转）
	TodaySources []VisitSourceCount `json:"today_sources"`
}

type VisitSourceCount struct {
	Source string `json:"source"`
	Host   string `json:"host"` // 仅其他网站（external）按域名区分
	Count  int64  `json:"count"`
}
