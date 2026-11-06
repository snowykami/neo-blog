package model

import (
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
)

// ErrorIssue 错误问题：指纹相同的错误事件聚合为一条（浏览器、Next.js 服务端与 Go 后端共用），见 service.ErrorReportService
type ErrorIssue struct {
	ID          uint   `gorm:"primaryKey"`
	Fingerprint string `gorm:"type:varchar(64);uniqueIndex;not null"`
	Source      string `gorm:"type:varchar(16);index"` // 见 constant.ErrorSource*
	Kind        string `gorm:"type:varchar(16);index"` // 见 constant.ErrorKind*
	Level       string `gorm:"type:varchar(16)"`       // fatal / error / warning / info
	Title       string `gorm:"type:varchar(512)"`
	Culprit     string `gorm:"type:varchar(512)"` // 出错位置：最内层的站内源码位置，或请求的方法与路径
	Status      string `gorm:"type:varchar(16);default:unresolved;index"`
	Count       int64  // 出现次数（含未保存完整事件的）
	LastRelease string `gorm:"type:varchar(64)"`
	FirstSeenAt time.Time
	LastSeenAt  time.Time `gorm:"index"`
	ResolvedAt  *time.Time
}

// ErrorEvent 一次错误事件的现场：同一问题每小时只保存有限条，其余只累计问题的次数
type ErrorEvent struct {
	ID        uint   `gorm:"primaryKey"`
	IssueID   uint   `gorm:"index:idx_error_events_issue_time"`
	EventID   string `gorm:"type:varchar(32);index"` // 上报方生成的事件 ID（错误页上显示，读者反馈时据此查找）
	Source    string `gorm:"type:varchar(16)"`
	Level     string `gorm:"type:varchar(16)"`
	Message   string `gorm:"type:text"`
	Path      string `gorm:"type:varchar(512)"` // 页面路径或请求路径
	Method    string `gorm:"type:varchar(8)"`   // 服务端错误的请求方法
	Release   string `gorm:"type:varchar(64)"`
	UserAgent string `gorm:"type:text"`
	OS        string `gorm:"type:varchar(32)"`
	OSVersion string `gorm:"type:varchar(32)"`
	Browser   string `gorm:"type:varchar(32)"`
	// 浏览器版本
	BrowserVersion string `gorm:"type:varchar(32)"`
	DeviceType     string `gorm:"type:varchar(16)"`
	Location       string `gorm:"type:varchar(128)"` // IP 归属地（不保存 IP 本身）
	VisitorID      *uint  `gorm:"index"`             // 开启请勿追踪时为空
	UserID         *uint  `gorm:"index"`             // 已登录的用户，开启请勿追踪时为空
	User           *User  `gorm:"constraint:OnDelete:SET NULL"`
	Anonymous      bool   // 开启了请勿追踪：不关联访客与用户，不保存设备信号
	// 现场详情：异常与调用栈、面包屑、浏览器与设备信息、标签、崩溃前的上下文等，见 service.errorEventDetail
	Detail    JSONMap
	CreatedAt time.Time `gorm:"index:idx_error_events_issue_time;index"`
}

func (i *ErrorIssue) ToDto() *dto.ErrorIssueDto {
	return &dto.ErrorIssueDto{
		ID:          i.ID,
		Source:      i.Source,
		Kind:        i.Kind,
		Level:       i.Level,
		Title:       i.Title,
		Culprit:     i.Culprit,
		Status:      i.Status,
		Count:       i.Count,
		LastRelease: i.LastRelease,
		FirstSeenAt: i.FirstSeenAt,
		LastSeenAt:  i.LastSeenAt,
		ResolvedAt:  i.ResolvedAt,
	}
}

// ToSummaryDto 事件列表中的一行（不含现场详情）
func (e *ErrorEvent) ToSummaryDto() *dto.ErrorEventSummaryDto {
	return &dto.ErrorEventSummaryDto{
		ID:             e.ID,
		IssueID:        e.IssueID,
		EventID:        e.EventID,
		Level:          e.Level,
		Message:        e.Message,
		Path:           e.Path,
		Method:         e.Method,
		Release:        e.Release,
		OS:             e.OS,
		OSVersion:      e.OSVersion,
		Browser:        e.Browser,
		BrowserVersion: e.BrowserVersion,
		DeviceType:     e.DeviceType,
		Location:       e.Location,
		VisitorID:      e.VisitorID,
		Anonymous:      e.Anonymous,
		CreatedAt:      e.CreatedAt,
	}
}

func (e *ErrorEvent) ToDto() *dto.ErrorEventDto {
	result := &dto.ErrorEventDto{
		ErrorEventSummaryDto: *e.ToSummaryDto(),
		Source:               e.Source,
		UserAgent:            e.UserAgent,
		Detail:               e.Detail,
	}
	if e.User != nil {
		user := e.User.ToDto()
		result.User = &user
	}
	return result
}
