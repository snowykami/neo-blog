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
	Kind       string `query:"kind"` // all / user / anonymous
	VisitorID  uint   `query:"visitor_id"`
	TargetType string `query:"target_type"`
	TargetID   uint   `query:"target_id"`
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
	ID          uint      `json:"id"`
	VisitorID   *uint     `json:"visitor_id"`
	VisitCount  int64     `json:"visit_count"` // 该访客的累计访问次数
	User        *UserDto  `json:"user"`
	TargetType  string    `json:"target_type"`
	TargetID    uint      `json:"target_id"`
	TargetTitle string    `json:"target_title"` // 文章/页面当前标题，已删除时为空
	TargetSlug  string    `json:"target_slug"`
	Path        string    `json:"path"`
	Referrer    string    `json:"referrer"`
	IP          string    `json:"ip"` // 已脱敏
	Location    string    `json:"location"`
	OS          string    `json:"os"`
	Browser     string    `json:"browser"`
	DeviceType  string    `json:"device_type"`
	CreatedAt   time.Time `json:"created_at"`
}

type VisitStatsDto struct {
	TodayPV         int64 `json:"today_pv"`
	TodayUV         int64 `json:"today_uv"`
	TodayUserVisits int64 `json:"today_user_visits"`
	TotalVisitors   int64 `json:"total_visitors"`
}
