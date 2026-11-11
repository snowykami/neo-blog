package dto

import "time"

// ListErrorIssuesReq 控制台按状态、来源与类型筛选错误问题；Query 匹配标题、出错位置，或按事件 ID 精确查找
type ListErrorIssuesReq struct {
	PaginationParams
	Status string `query:"status"` // 空为全部，见 constant.ErrorStatus*
	Source string `query:"source"` // 空为全部，见 constant.ErrorSource*
	Kind   string `query:"kind"`   // 空为全部，见 constant.ErrorKind*
	Query  string `query:"q"`
}

type ListErrorEventsReq struct {
	PaginationParams
}

type UpdateErrorIssueReq struct {
	Status string `json:"status"` // 见 constant.ErrorStatus*
}

type ErrorIssueDto struct {
	ID          uint       `json:"id"`
	Source      string     `json:"source"`
	Kind        string     `json:"kind"`
	Level       string     `json:"level"`
	Title       string     `json:"title"`
	Culprit     string     `json:"culprit"`
	Status      string     `json:"status"`
	Count       int64      `json:"count"`
	LastRelease string     `json:"last_release"`
	FirstSeenAt time.Time  `json:"first_seen_at"`
	LastSeenAt  time.Time  `json:"last_seen_at"`
	ResolvedAt  *time.Time `json:"resolved_at"`
}

// ErrorIssueDetailDto 问题详情：保存的事件中涉及的访客数与浏览器、系统分布
type ErrorIssueDetailDto struct {
	ErrorIssueDto
	StoredEvents int64        `json:"stored_events"`
	Visitors     int64        `json:"visitors"`
	Browsers     []NamedCount `json:"browsers"`
	OS           []NamedCount `json:"os"`
	Paths        []NamedCount `json:"paths"`
}

type ErrorEventSummaryDto struct {
	ID             uint      `json:"id"`
	IssueID        uint      `json:"issue_id"`
	EventID        string    `json:"event_id"`
	Level          string    `json:"level"`
	Message        string    `json:"message"`
	Path           string    `json:"path"`
	Method         string    `json:"method"`
	Release        string    `json:"release"`
	OS             string    `json:"os"`
	OSVersion      string    `json:"os_version"`
	Browser        string    `json:"browser"`
	BrowserVersion string    `json:"browser_version"`
	DeviceType     string    `json:"device_type"`
	Location       string    `json:"location"`
	VisitorID      *uint     `json:"visitor_id"`
	Anonymous      bool      `json:"anonymous"`
	CreatedAt      time.Time `json:"created_at"`
}

type ErrorEventDto struct {
	ErrorEventSummaryDto
	Source    string         `json:"source"`
	UserAgent string         `json:"user_agent"`
	User      *UserDto       `json:"user"`
	Detail    map[string]any `json:"detail"`
}

// ErrorReportStats 控制台顶部的汇总：未处理的问题数与最近 24 小时内出现过的问题数。
// 字段名不用 active_24h：前端请求层的 snake→camel 转换不处理下划线后接数字，会原样留下 active_24h，前端读不到
type ErrorReportStats struct {
	Unresolved    int64 `json:"unresolved"`
	ActiveLastDay int64 `json:"active_last_day"`
}
