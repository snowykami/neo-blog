package dto

import "time"

// AIAgentMatchDto 按名字或关键词查找 AI 用户的一个结果，用于判断平台上是否已有同一个人的 AI 用户
type AIAgentMatchDto struct {
	ID           uint       `json:"id"`
	Username     string     `json:"username"`
	Nickname     string     `json:"nickname"`
	Tier         string     `json:"tier"`
	Status       string     `json:"status"`
	Archetype    string     `json:"archetype"`
	MatchedBy    []string   `json:"matched_by"` // username / username_partial / nickname / nickname_partial / archetype / persona / profile
	LastActiveAt *time.Time `json:"last_active_at"`
}

// AIAgentMatchResult 查找结果：最像的排在前面；关键词中已被普通用户占用的用户名单独列出（不能用这些用户名导入 AI 用户）
type AIAgentMatchResult struct {
	Matches        []AIAgentMatchDto `json:"matches"`
	TakenUsernames []string          `json:"taken_usernames"`
}

// AIAgentFileDetail 按用户名读取的 AI 用户：与导入文件相同格式的资料与性格档案，以及状态和最近发过的评论
type AIAgentFileDetail struct {
	ID             uint            `json:"id"`
	Status         string          `json:"status"`
	PausedReason   string          `json:"paused_reason"`
	CreatedAt      time.Time       `json:"created_at"`
	LastActiveAt   *time.Time      `json:"last_active_at"`
	Agent          AIAgentFileItem `json:"agent"`
	RecentComments []string        `json:"recent_comments"` // 新的在前
}
