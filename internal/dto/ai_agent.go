package dto

import (
	"encoding/json"
	"time"

	"github.com/snowykami/neo-blog/pkg/errs"
)

// ---------- 性格档案（存于 ai_agents.profile，JSON） ----------

// AIAgentProfile AI 用户的性格档案：数字参数决定多常出现、更爱做什么，文字参数决定说什么、怎么说
type AIAgentProfile struct {
	Archetype     string               `json:"archetype"`      // 原型，如「夜猫子音乐党」
	Persona       string               `json:"persona"`        // 第一人称人设简介
	Interests     []string             `json:"interests"`      // 兴趣，用于推荐流匹配
	Expertise     []string             `json:"expertise"`      // 专长（专业型）
	Tone          string               `json:"tone"`           // 语气
	StyleSamples  []string             `json:"style_samples"`  // 示例评论，用于稳定风格
	Activity      AIAgentActivity      `json:"activity"`       // 活跃度与作息
	Behavior      AIAgentBehavior      `json:"behavior"`       // 行为倾向（写进提示词，实际动作由模型决定）
	Limits        AIAgentLimits        `json:"limits"`         // 个体上限
	Triggers      []string             `json:"triggers"`       // browse / post.published / comment.replied
	BlockedTopics []string             `json:"blocked_topics"` // 不讨论的话题
	AIInteraction AIAgentAIInteraction `json:"ai_interaction"` // 与其他 AI 用户互动
	SelfEdit      AIAgentSelfEdit      `json:"self_edit"`      // 自行修改资料
	Memory        AIAgentMemoryConfig  `json:"memory"`         // 记忆
	WebFetch      AIAgentWebFetch      `json:"web_fetch"`      // 网页获取（专业型）
	ModelOverride string               `json:"model_override"` // 留空时按类型使用全站配置的模型
}

type AIAgentActivity struct {
	DailyActions  float64 `json:"daily_actions"`  // 日均被唤醒次数的期望
	ActiveHours   string  `json:"active_hours"`   // 作息，如 "9-12,20-24"；跨零点写成 "22-2"；留空为全天
	Timezone      string  `json:"timezone"`       // IANA 时区，留空为 Asia/Shanghai
	WeekendFactor float64 `json:"weekend_factor"` // 周末活跃度倍数
}

type AIAgentBehavior struct {
	Lurk             float64 `json:"lurk"`              // 看完什么都不做的倾向
	Like             float64 `json:"like"`              // 点赞倾向
	Comment          float64 `json:"comment"`           // 评论倾向
	ReplyProbability float64 `json:"reply_probability"` // 被回复时回应的概率
	DigOldPosts      float64 `json:"dig_old_posts"`     // 推荐流里混入旧文的比例
	DelayMinMinutes  int     `json:"delay_min_minutes"` // 事件触发后行动前的随机延迟
	DelayMaxMinutes  int     `json:"delay_max_minutes"`
}

type AIAgentLimits struct {
	CommentsPerDay  int `json:"comments_per_day"`
	LikesPerDay     int `json:"likes_per_day"`
	CommentsPerPost int `json:"comments_per_post"`
	CooldownMinutes int `json:"cooldown_minutes"` // 两次评论之间的最短间隔
}

type AIAgentAIInteraction struct {
	Enabled         bool    `json:"enabled"`          // 是否与其他 AI 用户互动
	BaseProbability float64 `json:"base_probability"` // 回应 AI 的基础概率，再按 0.5^深度 递减
}

type AIAgentSelfEdit struct {
	Enabled bool     `json:"enabled"`
	Fields  []string `json:"fields"` // avatar / background / nickname / preferred_color
	Hint    string   `json:"hint"`   // 写进提示词的频率约束
}

type AIAgentMemoryConfig struct {
	RememberPeople       bool    `json:"remember_people"`
	RetentionDays        int     `json:"retention_days"`        // 0 时按类型使用全站配置
	MaxItems             int     `json:"max_items"`             // 情景记忆条数上限
	MilestoneFamiliarity float64 `json:"milestone_familiarity"` // 熟悉度达到该值记为里程碑
}

type AIAgentWebFetch struct {
	Enabled        bool     `json:"enabled"`
	AllowedDomains []string `json:"allowed_domains"` // 为空时允许任意公网域名
}

// ---------- 管理接口 ----------

// AIAgentDto 管理后台的 AI 用户
type AIAgentDto struct {
	ID            uint           `json:"id"`
	User          UserDto        `json:"user"`
	Tier          string         `json:"tier"`
	Status        string         `json:"status"`
	PausedReason  string         `json:"paused_reason"`
	GroupID       *uint          `json:"group_id"`
	GroupName     string         `json:"group_name,omitempty"`
	Profile       AIAgentProfile `json:"profile"`
	SelfSummary   string         `json:"self_summary"`
	LastActiveAt  *time.Time     `json:"last_active_at"`
	CreatedAt     time.Time      `json:"created_at"`
	TodayComments int64          `json:"today_comments"`
	TodayLikes    int64          `json:"today_likes"`
	MonthTokens   int64          `json:"month_tokens"`
}

// AIAgentStatsDto AI 用户总览与全站额度
type AIAgentStatsDto struct {
	Enabled             bool  `json:"enabled"`       // 全站开关
	AIConfigured        bool  `json:"ai_configured"` // 后台 AI 配置是否完整
	RunnerOnline        bool  `json:"runner_online"` // 最近 2 分钟内有实例的 worker 在检查任务
	Total               int64 `json:"total"`
	Ambient             int64 `json:"ambient"`
	Expert              int64 `json:"expert"`
	Active              int64 `json:"active"`
	Paused              int64 `json:"paused"`
	Groups              int64 `json:"groups"`
	QueuedRuns          int64 `json:"queued_runs"`
	TodayComments       int64 `json:"today_comments"`
	TodayLikes          int64 `json:"today_likes"`
	HourLLMCalls        int64 `json:"hour_llm_calls"`
	MonthTokens         int64 `json:"month_tokens"`
	CommentsPerDayLimit int   `json:"comments_per_day_limit"`
	LikesPerDayLimit    int   `json:"likes_per_day_limit"`
	LLMCallsPerHour     int   `json:"llm_calls_per_hour"`
	MonthlyTokenBudget  int   `json:"monthly_token_budget"` // 0 为不限
}

type AdminListAIAgentsReq struct {
	PaginationParams
	Query   string `query:"query"`
	Tier    string `query:"tier"`
	Status  string `query:"status"`
	GroupID uint   `query:"group_id"`
}

// CreateAIAgentReq 新建 AI 用户（同时创建账号）
type CreateAIAgentReq struct {
	Username  string          `json:"username"`
	Nickname  string          `json:"nickname"`
	AvatarUrl string          `json:"avatar_url"`
	Tier      string          `json:"tier"`
	Profile   *AIAgentProfile `json:"profile"` // 为空时使用该类型的默认档案
}

// ConvertUserToAIReq 把已有普通用户设为 AI 用户
type ConvertUserToAIReq struct {
	ID      uint            `path:"id"`
	Tier    string          `json:"tier"`
	Profile *AIAgentProfile `json:"profile"`
}

type UpdateAIAgentReq struct {
	ID      uint            `path:"id"`
	Tier    string          `json:"tier"`
	Profile *AIAgentProfile `json:"profile"`
}

// ---------- 导入导出 ----------

// AIAgentFileItem 导入导出文件中的一个 AI 用户：只含能在站点间迁移的账号资料、类型与性格档案，不含记忆、关系与运行记录。
// 文件内容为单个对象（一个 AI 用户）或对象数组（多个），由前端读写文件时转换为下面接口中的 agents
type AIAgentFileItem struct {
	Username       string `json:"username"`
	Nickname       string `json:"nickname"`
	AvatarUrl      string `json:"avatar_url"`
	BackgroundUrl  string `json:"background_url"`
	PreferredColor string `json:"preferred_color"`
	Tier           string `json:"tier"`
	// Profile 即 AIAgentProfile；导入时缺少的字段（含嵌套对象中的字段）取该类型的默认值，数组整体替换
	Profile json.RawMessage `json:"profile,omitempty"`
}

// ExportAIAgentsReq 导出：指定 ID 时只导出这一个，指定 IDs 时导出这些，否则按列表的筛选条件导出全部（忽略分页；不带筛选条件即导出所有）
type ExportAIAgentsReq struct {
	AdminListAIAgentsReq
	ID  uint   `query:"id"`
	IDs string `query:"ids"` // 逗号分隔的 AI 用户 ID，导出勾选的
}

// BatchAIAgentsReq 批量操作：pause 暂停 / resume 恢复 / delete 取消 AI 身份
type BatchAIAgentsReq struct {
	IDs    []uint `json:"ids"`
	Action string `json:"action"`
}

// BatchAIAgentsResp 批量操作的结果：不存在等原因失败的 ID 单独列出，不影响其他
type BatchAIAgentsResp struct {
	Succeeded int    `json:"succeeded"`
	Failed    []uint `json:"failed"`
}

// ImportAIAgentsReq 导入：按用户名逐个新建或更新，单个失败不影响其他
type ImportAIAgentsReq struct {
	Agents []AIAgentFileItem `json:"agents"`
	DryRun bool              `json:"dry_run"` // 只校验并给出每一项将执行的操作，不写入
}

// ImportAIAgentResult 导入时每一项的结果
type ImportAIAgentResult struct {
	Index   int        `json:"index"`              // 在 agents 中的下标
	Action  string     `json:"action,omitempty"`   // create：新建；update：已有同名 AI 用户，更新类型与性格档案。失败时为空
	AgentID uint       `json:"agent_id,omitempty"` // 新建或更新的 AI 用户；试运行新建时为 0
	Error   *errs.Body `json:"error,omitempty"`
}

// AIAgentDryRunReq 试运行：用指定文章或评论预演，只输出操作列表不执行
type AIAgentDryRunReq struct {
	ID         uint   `path:"id"`
	TargetType string `json:"target_type"` // post / comment
	TargetID   uint   `json:"target_id"`
}

// ---------- 运行记录 ----------

// AgentActionDto 操作列表中的一个动作，以及执行器回报的结果
type AgentActionDto struct {
	Type           string `json:"type"`             // like / comment / reply / update_profile / set_avatar
	Target         string `json:"target,omitempty"` // post:12 / comment:34
	Content        string `json:"content,omitempty"`
	Liked          *bool  `json:"liked,omitempty"` // like 动作：false 表示取消点赞
	Nickname       string `json:"nickname,omitempty"`
	PreferredColor string `json:"preferred_color,omitempty"`
	ImageURL       string `json:"image_url,omitempty"`
	Kind           string `json:"kind,omitempty"` // set_avatar：avatar / background
	License        string `json:"license,omitempty"`
	Author         string `json:"author,omitempty"`
	Source         string `json:"source,omitempty"`
	Result         string `json:"result,omitempty"` // ok / error / skipped
	Detail         string `json:"detail,omitempty"`
	CommentID      uint   `json:"comment_id,omitempty"`
}

// AgentEffectDto 后端记录的实际写入，撤回时据此回滚
type AgentEffectDto struct {
	Type       string `json:"type"` // comment / like / profile
	CommentID  uint   `json:"comment_id,omitempty"`
	TargetType string `json:"target_type,omitempty"`
	TargetID   uint   `json:"target_id,omitempty"`
	Liked      bool   `json:"liked,omitempty"`
	Field      string `json:"field,omitempty"` // profile：nickname / avatar_url / background_url / preferred_color
	Old        string `json:"old,omitempty"`
	New        string `json:"new,omitempty"`
	Reverted   bool   `json:"reverted,omitempty"`
}

type AgentTraceStep struct {
	At     time.Time `json:"at"`
	Step   string    `json:"step"`
	Detail string    `json:"detail"`
}

type AgentUserBrief struct {
	ID        uint   `json:"id"`
	Username  string `json:"username"`
	Nickname  string `json:"nickname"`
	AvatarUrl string `json:"avatar_url"`
}

type AgentRunDto struct {
	ID               uint             `json:"id"`
	AgentID          uint             `json:"agent_id"`
	Agent            *AgentUserBrief  `json:"agent,omitempty"`
	Kind             string           `json:"kind"`
	Trigger          string           `json:"trigger"`
	TargetType       string           `json:"target_type"`
	TargetID         uint             `json:"target_id"`
	TargetTitle      string           `json:"target_title,omitempty"`
	Status           string           `json:"status"`
	SkipReason       string           `json:"skip_reason"`
	ScheduledAt      time.Time        `json:"scheduled_at"`
	FinishedAt       *time.Time       `json:"finished_at"`
	Actions          []AgentActionDto `json:"actions"`
	Effects          []AgentEffectDto `json:"effects"`
	Reason           string           `json:"reason"`
	MemoryNote       string           `json:"memory_note"`
	Model            string           `json:"model"`
	PromptTokens     int              `json:"prompt_tokens"`
	CachedTokens     int              `json:"cached_tokens"`
	CompletionTokens int              `json:"completion_tokens"`
	LLMCalls         int              `json:"llm_calls"`
	Trace            []AgentTraceStep `json:"trace"`
	Error            string           `json:"error"`
	Reverted         bool             `json:"reverted"`
	CreatedAt        time.Time        `json:"created_at"`
}

type ListAgentRunsReq struct {
	PaginationParams
	AgentID uint   `query:"agent_id"`
	Status  string `query:"status"`
	Action  string `query:"action"` // 按产生的动作筛选：comment / like / profile / none
	Trigger string `query:"trigger"`
}

// ---------- 记忆 ----------

type AgentMemoryDto struct {
	ID            uint       `json:"id"`
	AgentID       uint       `json:"agent_id"`
	Kind          string     `json:"kind"`
	SubjectUserID *uint      `json:"subject_user_id"`
	SubjectName   string     `json:"subject_name,omitempty"`
	TargetType    string     `json:"target_type"`
	TargetID      uint       `json:"target_id"`
	Content       string     `json:"content"`
	Importance    float64    `json:"importance"`
	Pinned        bool       `json:"pinned"`
	SourceRunID   uint       `json:"source_run_id"`
	ExpiresAt     *time.Time `json:"expires_at"`
	CreatedAt     time.Time  `json:"created_at"`
}

type ListAgentMemoriesReq struct {
	PaginationParams
	ID            uint   `path:"id"`
	Kind          string `query:"kind"`
	SubjectUserID uint   `query:"subject_user_id"`
	Query         string `query:"query"`
}

type UpdateAgentMemoryReq struct {
	ID         uint     `path:"id"`
	Content    *string  `json:"content"`
	Importance *float64 `json:"importance"`
	Pinned     *bool    `json:"pinned"`
}

type AgentRelationDto struct {
	ID               uint           `json:"id"`
	AgentID          uint           `json:"agent_id"`
	User             AgentUserBrief `json:"user"`
	Familiarity      float64        `json:"familiarity"`
	Impression       string         `json:"impression"`
	Topics           []string       `json:"topics"`
	Interactions     int            `json:"interactions"`
	LastInteractedAt *time.Time     `json:"last_interacted_at"`
	MilestoneAt      *time.Time     `json:"milestone_at"`
}

// ---------- 群体（人设工厂） ----------

type AIAgentArchetype struct {
	Name            string  `json:"name"`
	Description     string  `json:"description"`
	Ratio           float64 `json:"ratio"` // 占比，各原型之和不必为 1，按比例分配
	DailyActionsMin float64 `json:"daily_actions_min"`
	DailyActionsMax float64 `json:"daily_actions_max"`
	Comment         float64 `json:"comment"` // 评论倾向
}

type AIAgentGroupTemplate struct {
	Tier          string             `json:"tier"`
	Archetypes    []AIAgentArchetype `json:"archetypes"`
	Interests     []string           `json:"interests"`
	BlockedTopics []string           `json:"blocked_topics"`
	AvatarStyle   string             `json:"avatar_style"` // dicebear 风格，如 notionists
	Language      string             `json:"language"`     // 人设使用的语言，默认 zh
}

type AIAgentGroupDto struct {
	ID       uint                 `json:"id"`
	Name     string               `json:"name"`
	Template AIAgentGroupTemplate `json:"template"`
	Status   string               `json:"status"` // generating / done / failed
	Total    int                  `json:"total"`
	Created  int                  `json:"created"`
	Error    string               `json:"error"`
	// 生成中但执行的实例已退出：等待其他实例接手（job_recovery，约一分钟内），之后从 created 继续
	Interrupted bool      `json:"interrupted"`
	AgentCount  int64     `json:"agent_count"`
	ActiveCount int64     `json:"active_count"`
	CreatedAt   time.Time `json:"created_at"`
}

type GenerateAIAgentGroupReq struct {
	Name     string               `json:"name"`
	Count    int                  `json:"count"`
	Template AIAgentGroupTemplate `json:"template"`
	Preview  bool                 `json:"preview"` // 只生成预览（最多 10 个），不创建账号
}

// AIAgentPreview 人设工厂生成的一个人设
type AIAgentPreview struct {
	Nickname     string   `json:"nickname"`
	Archetype    string   `json:"archetype"`
	Persona      string   `json:"persona"`
	Interests    []string `json:"interests"`
	Tone         string   `json:"tone"`
	StyleSamples []string `json:"style_samples"`
	DailyActions float64  `json:"daily_actions"`
}

type GenerateAIAgentGroupResp struct {
	Group   *AIAgentGroupDto `json:"group,omitempty"`
	Preview []AIAgentPreview `json:"preview,omitempty"`
}

type UpdateAIAgentGroupStatusReq struct {
	ID     uint   `path:"id"`
	Status string `json:"status"` // active / paused
}

// ---------- worker 领取的运行（见 internal/agentrunner） ----------

type AgentPostRef struct {
	ID           uint      `json:"id"`
	Title        string    `json:"title"`
	Summary      string    `json:"summary"`
	Labels       []string  `json:"labels"`
	Category     string    `json:"category,omitempty"`
	Author       string    `json:"author"`
	AuthorID     uint      `json:"author_id"`
	URL          string    `json:"url"`
	CreatedAt    time.Time `json:"created_at"`
	CommentCount uint64    `json:"comment_count"`
	LikeCount    uint64    `json:"like_count"`
	Commented    bool      `json:"commented"` // 自己是否已评论过
	Liked        bool      `json:"liked"`     // 自己是否已点过赞
}

type AgentCommentRef struct {
	ID         uint   `json:"id"`
	Content    string `json:"content"`
	AuthorID   uint   `json:"author_id"`
	AuthorName string `json:"author_name"`
	TargetType string `json:"target_type"`
	TargetID   uint   `json:"target_id"`
	ReplyID    uint   `json:"reply_id"`
	RootID     uint   `json:"root_id"`
	// ReplyToContent 被回复的那条评论（通常是 AI 自己的评论）
	ReplyToContent string `json:"reply_to_content,omitempty"`
}

type AgentLeaseEvent struct {
	TargetType string           `json:"target_type"`
	TargetID   uint             `json:"target_id"`
	Post       *AgentPostRef    `json:"post,omitempty"`
	Comment    *AgentCommentRef `json:"comment,omitempty"`
	AIDepth    int              `json:"ai_depth"` // 触发评论所在回复链的 AI 互动深度
}

type AgentLeaseAgent struct {
	UserID      uint           `json:"user_id"`
	Username    string         `json:"username"`
	Nickname    string         `json:"nickname"`
	AvatarUrl   string         `json:"avatar_url"`
	Tier        string         `json:"tier"`
	Profile     AIAgentProfile `json:"profile"`
	SelfSummary string         `json:"self_summary"`
}

type AgentRelationBrief struct {
	UserID      uint     `json:"user_id"`
	Name        string   `json:"name"`
	Familiarity float64  `json:"familiarity"`
	Impression  string   `json:"impression"`
	Topics      []string `json:"topics"`
}

type AgentEpisodeBrief struct {
	Content string    `json:"content"`
	At      time.Time `json:"at"`
}

type AgentLeaseMemories struct {
	Relations []AgentRelationBrief `json:"relations"`
	Episodes  []AgentEpisodeBrief  `json:"episodes"`
}

type AgentLeaseQuota struct {
	CommentsToday int64 `json:"comments_today"`
	CommentsLimit int   `json:"comments_limit"`
	LikesToday    int64 `json:"likes_today"`
	LikesLimit    int   `json:"likes_limit"`
	MaxActions    int   `json:"max_actions"`
}

type AgentLeaseRun struct {
	RunID          uint               `json:"run_id"`
	LeaseToken     string             `json:"lease_token"`
	Kind           string             `json:"kind"`
	Trigger        string             `json:"trigger"`
	DryRun         bool               `json:"dry_run"`
	LeaseExpiresAt time.Time          `json:"lease_expires_at"`
	Agent          AgentLeaseAgent    `json:"agent"`
	Event          *AgentLeaseEvent   `json:"event,omitempty"`
	Feed           []AgentPostRef     `json:"feed"`
	Memories       AgentLeaseMemories `json:"memories"`
	Quota          AgentLeaseQuota    `json:"quota"`
	SelfEditHint   string             `json:"self_edit_hint"`
	RecentComments []string           `json:"recent_comments"` // 自己最近发过的评论（新的在前），提示词要求不重复开头、句式和观点
	CanSelfEdit    bool               `json:"can_self_edit"`
	MaxSteps       int                `json:"max_steps"` // 阅读阶段最多调用只读工具的轮数，氛围型为 0
	// Vision 已开启识图：读文章时把正文图片附给模型；VisionUnsupported 开启了识图但所用模型最近拒收过图片，本次按纯文本阅读
	Vision            bool `json:"vision"`
	VisionUnsupported bool `json:"vision_unsupported"`
}

type AgentLeaseSite struct {
	Name    string `json:"name"`
	BaseURL string `json:"base_url"`
}

type AgentCompleteReq struct {
	ID         uint             `json:"id"`
	LeaseToken string           `json:"lease_token"`
	Status     string           `json:"status"` // done / failed
	Actions    []AgentActionDto `json:"actions"`
	Reason     string           `json:"reason"`
	MemoryNote string           `json:"memory_note"`
	Trace      []AgentTraceStep `json:"trace"`
	Error      string           `json:"error"`
}
