package dto

import "time"

type EditSessionDto struct {
	SessionID string    `json:"session_id,omitempty"` // 仅申请会话时返回
	User      UserDto   `json:"user"`                 // 当前持有编辑会话的用户
	OS        string    `json:"os"`                   // 持有会话的设备系统，基于User-Agent
	Browser   string    `json:"browser"`              // 持有会话的设备浏览器，基于User-Agent
	StartedAt time.Time `json:"started_at"`           // 会话开启时间
	IsCurrent bool      `json:"is_current"`           // 请求方携带的会话是否仍是当前会话
}
