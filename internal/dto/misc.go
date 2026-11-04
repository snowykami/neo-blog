package dto

import "time"

// RuntimeInstanceDto 一个后端实例的运行时指标快照
type RuntimeInstanceDto struct {
	InstanceID string         `json:"instance_id"`
	Hostname   string         `json:"hostname"` // 容器部署时为容器 / Pod 名
	PID        int            `json:"pid"`
	StartedAt  time.Time      `json:"started_at"`
	UpdatedAt  time.Time      `json:"updated_at"` // 快照时间；处理本次请求的实例为实时数据
	Current    bool           `json:"current"`    // 是否为处理本次请求的实例
	Metrics    map[string]any `json:"metrics"`
}

// RuntimeMetricsResp 全部存活后端实例的运行时指标
type RuntimeMetricsResp struct {
	Shared    bool                 `json:"shared"` // 是否通过 Redis 共享（多副本可见）；否则只有本实例
	Instances []RuntimeInstanceDto `json:"instances"`
}
