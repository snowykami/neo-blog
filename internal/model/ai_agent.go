package model

import (
	"encoding/json"
	"time"

	"github.com/snowykami/neo-blog/internal/dto"
)

// 以下表不使用软删除：删除后可能以相同唯一键重建（如取消后再次设为 AI），记忆与运行记录也不需要回收站

// AIAgent AI 用户的 Agent 配置，与 users 一对一
type AIAgent struct {
	ID             uint `gorm:"primaryKey"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
	UserID         uint   `gorm:"uniqueIndex;not null"`
	User           User   `gorm:"foreignKey:UserID;references:ID"`
	GroupID        *uint  `gorm:"index"`
	Tier           string `gorm:"type:varchar(16);default:'ambient'"`
	Status         string `gorm:"type:varchar(16);default:'active';index"`
	PausedReason   string `gorm:"type:varchar(64)"`
	Profile        string `gorm:"type:text"` // JSON：dto.AIAgentProfile
	SelfSummary    string `gorm:"type:text"` // 自我记忆摘要，夜间整理覆盖
	LastActiveAt   *time.Time
	ConsolidatedAt *time.Time // 上次整理记忆的时间
}

// TableName 默认命名会把 AIAgent 拆成 a_i_agents
func (AIAgent) TableName() string { return "ai_agents" }

// ParsedProfile 解析性格档案，损坏时返回空档案
func (a *AIAgent) ParsedProfile() dto.AIAgentProfile {
	var p dto.AIAgentProfile
	if a.Profile != "" {
		_ = json.Unmarshal([]byte(a.Profile), &p)
	}
	return p
}

// AIAgentGroup 人设工厂批量生成的一组 AI 用户
type AIAgentGroup struct {
	ID        uint `gorm:"primaryKey"`
	CreatedAt time.Time
	UpdatedAt time.Time
	Name      string `gorm:"type:varchar(64)"`
	Template  string `gorm:"type:text"`        // JSON：dto.AIAgentGroupTemplate
	Status    string `gorm:"type:varchar(16)"` // generating / done / failed
	Total     int
	Created   int
	Error     string `gorm:"type:text"`
}

func (AIAgentGroup) TableName() string { return "ai_agent_groups" }

// AgentRun 一次唤醒或事件：既是 worker 的待办，也是审计日志
type AgentRun struct {
	ID               uint      `gorm:"primaryKey"`
	CreatedAt        time.Time `gorm:"index"`
	UpdatedAt        time.Time
	AgentID          uint      `gorm:"index"`
	Kind             string    `gorm:"type:varchar(16)"`
	Trigger          string    `gorm:"column:trigger_type;type:varchar(32)"` // trigger 是 SQL 关键字
	TargetType       string    `gorm:"type:varchar(16)"`
	TargetID         uint      `gorm:"index"`
	Feed             string    `gorm:"type:text"` // JSON：推荐流文章 ID
	Status           string    `gorm:"type:varchar(16);index:idx_agent_run_status_scheduled,priority:1"`
	ScheduledAt      time.Time `gorm:"index:idx_agent_run_status_scheduled,priority:2"`
	LeaseUntil       *time.Time
	Attempts         int
	SkipReason       string `gorm:"type:varchar(64)"`
	Actions          string `gorm:"type:text"` // JSON：[]dto.AgentActionDto，worker 回报的操作列表与执行结果
	Effects          string `gorm:"type:text"` // JSON：[]dto.AgentEffectDto，后端记录的实际写入
	Reason           string `gorm:"type:text"`
	MemoryNote       string `gorm:"type:text"`
	Model            string `gorm:"type:varchar(128)"`
	PromptTokens     int
	CachedTokens     int
	CompletionTokens int
	LLMCalls         int    `gorm:"column:llm_calls"`
	Trace            string `gorm:"type:text"` // JSON：[]dto.AgentTraceStep
	Error            string `gorm:"type:text"`
	Reverted         bool
	FinishedAt       *time.Time
}

func (AgentRun) TableName() string { return "agent_runs" }

// AgentMemory 情景记忆与里程碑
type AgentMemory struct {
	ID            uint      `gorm:"primaryKey"`
	CreatedAt     time.Time `gorm:"index"`
	UpdatedAt     time.Time
	AgentID       uint   `gorm:"index"`
	Kind          string `gorm:"type:varchar(16)"`
	SubjectUserID *uint  `gorm:"index"` // 涉及的人
	TargetType    string `gorm:"type:varchar(16)"`
	TargetID      uint
	Content       string `gorm:"type:text"`
	Importance    float64
	Pinned        bool
	SourceRunID   uint
	ExpiresAt     *time.Time `gorm:"index"`
}

func (AgentMemory) TableName() string { return "agent_memories" }

// AgentRelation 一个 AI 用户对一个人（也可以是另一个 AI 用户）的关系
type AgentRelation struct {
	ID               uint `gorm:"primaryKey"`
	CreatedAt        time.Time
	UpdatedAt        time.Time
	AgentID          uint    `gorm:"uniqueIndex:idx_agent_relation_pair"`
	UserID           uint    `gorm:"uniqueIndex:idx_agent_relation_pair;index"`
	Score            float64 // 按时间衰减累加的互动权重，熟悉度 = 1 - e^(-Score)
	ScoreAt          time.Time
	Familiarity      float64
	Impression       string `gorm:"type:text"`
	Topics           string `gorm:"type:text"` // JSON：[]string
	Interactions     int
	LastInteractedAt *time.Time
	MilestoneAt      *time.Time
}

func (AgentRelation) TableName() string { return "agent_relations" }
