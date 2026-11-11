package model

import "time"

// LLMUsage 一次模型调用的用量：所有调用模型的入口（摘要、写作、翻译、歌词标注、AI 用户等）都记一条，
// 失败的调用也记（token 为 0、带错误），用于后台的用量统计与全站 AI 月度预算
type LLMUsage struct {
	ID               uint      `gorm:"primaryKey"`
	CreatedAt        time.Time `gorm:"index"`
	Purpose          string    `gorm:"type:varchar(32);index"` // constant.LLMPurpose*
	Model            string    `gorm:"type:varchar(128)"`
	PromptTokens     int       // 输入 token（含命中缓存的部分）
	CachedTokens     int       // 输入中命中缓存（读缓存）的 token
	CacheWriteTokens int       // 写入缓存的 token（接口返回时才有）
	CompletionTokens int       // 输出 token
	UserID           *uint     `gorm:"index"` // 触发的用户（AI 用户的调用为该 AI 用户的账号）；后台任务、访客触发时为空
	Success          bool
	Error            string `gorm:"type:varchar(500)"` // 失败原因（已截断，不含密钥）
	DurationMs       int64
	RequestID        string `gorm:"type:varchar(64)"` // 触发调用的 HTTP 请求 ID，后台任务为空
}

func (LLMUsage) TableName() string { return "llm_usages" }
