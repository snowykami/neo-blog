// AI 用户（由 Agent 驱动的普通账号）相关模型，与后端 internal/dto/ai_agent.go 对应
import type { User } from './user'
import type { ApiErrorBody } from '@/utils/common/error'

export const AI_AGENT_TIERS = ['ambient', 'expert'] as const
export type AIAgentTier = (typeof AI_AGENT_TIERS)[number]

export const AI_AGENT_STATUSES = ['active', 'paused'] as const
export type AIAgentStatus = (typeof AI_AGENT_STATUSES)[number]

export const AI_AGENT_TRIGGERS = ['browse', 'post.published', 'comment.replied', 'comment.mentioned'] as const
export type AIAgentTrigger = (typeof AI_AGENT_TRIGGERS)[number]

// 运行记录的触发方式（比性格档案的触发方式多一个试运行）
export const AGENT_RUN_TRIGGERS = ['browse', 'post.published', 'comment.replied', 'comment.mentioned', 'dry_run'] as const
export type AgentRunTrigger = (typeof AGENT_RUN_TRIGGERS)[number]

export const AGENT_RUN_KINDS = ['browse', 'event', 'dry_run'] as const
export type AgentRunKind = (typeof AGENT_RUN_KINDS)[number]

export const AGENT_RUN_STATUSES = ['queued', 'leased', 'done', 'skipped', 'failed'] as const
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number]

// 运行记录按产生的动作筛选
export const AGENT_RUN_ACTION_FILTERS = ['comment', 'like', 'profile', 'none'] as const
export type AgentRunActionFilter = (typeof AGENT_RUN_ACTION_FILTERS)[number]

export const AGENT_ACTION_TYPES = ['like', 'comment', 'reply', 'update_profile', 'set_avatar'] as const
export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number]

export const AGENT_MEMORY_KINDS = ['episode', 'milestone'] as const
export type AgentMemoryKind = (typeof AGENT_MEMORY_KINDS)[number]

export const AI_AGENT_SELF_EDIT_FIELDS = ['avatar', 'background', 'nickname', 'preferred_color'] as const
export type AIAgentSelfEditField = (typeof AI_AGENT_SELF_EDIT_FIELDS)[number]

// 群体生成状态
export type AIAgentGroupStatus = 'generating' | 'done' | 'failed'

export interface AIAgentActivity {
  dailyActions: number // 日均被唤醒次数的期望
  activeHours: string // 作息，如 "9-12,20-24"；跨零点写成 "22-2"；留空为全天
  timezone: string // 标准 IANA 时区，后端在留空时使用 Asia/Shanghai
  weekendFactor: number // 周末活跃度倍数
}

// 行为倾向：0~1，写进提示词，实际动作由模型决定
export interface AIAgentBehavior {
  lurk: number
  like: number
  comment: number
  replyProbability: number
  digOldPosts: number
  delayMinMinutes: number
  delayMaxMinutes: number
}

export interface AIAgentLimits {
  commentsPerDay: number
  likesPerDay: number
  commentsPerPost: number
  cooldownMinutes: number
}

export interface AIAgentAIInteraction {
  enabled: boolean
  baseProbability: number // 回应 AI 的基础概率，再按 0.5^深度 递减
}

export interface AIAgentSelfEdit {
  enabled: boolean
  fields: AIAgentSelfEditField[]
  hint: string // 写进提示词的频率约束
}

export interface AIAgentMemoryConfig {
  rememberPeople: boolean
  retentionDays: number // 0 时按类型使用全站配置
  maxItems: number
  milestoneFamiliarity: number
}

export interface AIAgentWebFetch {
  enabled: boolean
  allowedDomains: string[] // 为空时允许任意公网域名
}

export interface AIAgentProfile {
  archetype: string
  persona: string
  interests: string[]
  expertise: string[]
  tone: string
  styleSamples: string[]
  activity: AIAgentActivity
  behavior: AIAgentBehavior
  limits: AIAgentLimits
  triggers: AIAgentTrigger[]
  blockedTopics: string[]
  aiInteraction: AIAgentAIInteraction
  selfEdit: AIAgentSelfEdit
  memory: AIAgentMemoryConfig
  webFetch: AIAgentWebFetch
  modelOverride: string // 留空时按类型使用全站配置的模型
}

export interface AIAgent {
  id: number
  user: User
  tier: AIAgentTier
  status: AIAgentStatus
  pausedReason: string
  groupId: number | null
  groupName?: string
  profile: AIAgentProfile
  selfSummary: string
  lastActiveAt: string | null
  createdAt: string
  todayComments: number
  todayLikes: number
  monthTokens: number
}

export interface AIAgentStats {
  enabled: boolean // 全站开关
  aiConfigured: boolean // 后台 AI 配置是否完整
  runnerOnline: boolean // 最近 2 分钟内有实例的 worker 在检查任务
  total: number
  ambient: number
  expert: number
  active: number
  paused: number
  groups: number
  queuedRuns: number
  todayComments: number
  todayLikes: number
  hourLlmCalls: number
  monthTokens: number
  commentsPerDayLimit: number
  likesPerDayLimit: number
  llmCallsPerHour: number
  monthlyTokenBudget: number // 0 为不限
}

// 操作列表中的一个动作，以及执行器回报的结果
export interface AgentAction {
  type: AgentActionType
  target?: string // post:12 / comment:34
  content?: string
  liked?: boolean // like 动作：false 表示取消点赞
  nickname?: string
  preferredColor?: string
  imageUrl?: string
  kind?: string // set_avatar：avatar / background
  license?: string
  author?: string
  source?: string
  result?: string // ok / error / skipped
  detail?: string
  commentId?: number
}

// 实际写入，撤回时据此回滚
export interface AgentEffect {
  type: 'comment' | 'like' | 'profile' | string
  commentId?: number
  targetType?: string
  targetId?: number
  liked?: boolean
  field?: string // profile：nickname / avatar_url / background_url / preferred_color
  old?: string
  new?: string
  reverted?: boolean
}

export interface AgentTraceStep {
  at: string
  step: string
  detail: string
}

export interface AgentUserBrief {
  id: number
  username: string
  nickname: string
  avatarUrl: string
}

export interface AgentRun {
  id: number
  agentId: number
  agent?: AgentUserBrief
  kind: AgentRunKind
  trigger: AgentRunTrigger
  targetType: string
  targetId: number
  targetTitle?: string
  status: AgentRunStatus
  skipReason: string
  scheduledAt: string
  finishedAt: string | null
  actions: AgentAction[] | null
  effects: AgentEffect[] | null
  reason: string
  memoryNote: string
  model: string
  promptTokens: number
  cachedTokens: number
  completionTokens: number
  llmCalls: number
  trace: AgentTraceStep[] | null
  error: string
  reverted: boolean
  createdAt: string
}

export interface AgentMemory {
  id: number
  agentId: number
  kind: AgentMemoryKind
  subjectUserId: number | null
  subjectName?: string
  targetType: string
  targetId: number
  content: string
  importance: number
  pinned: boolean
  sourceRunId: number
  expiresAt: string | null
  createdAt: string
}

export interface AgentRelation {
  id: number
  agentId: number
  user: AgentUserBrief
  familiarity: number
  impression: string
  topics: string[] | null
  interactions: number
  lastInteractedAt: string | null
  milestoneAt: string | null
}

export interface AIAgentArchetype {
  name: string
  description: string
  ratio: number // 占比，各原型之和不必为 1，按比例分配
  dailyActionsMin: number
  dailyActionsMax: number
  comment: number // 评论倾向 0~1
}

export interface AIAgentGroupTemplate {
  tier: AIAgentTier
  archetypes: AIAgentArchetype[]
  interests: string[]
  blockedTopics: string[]
  avatarStyle: string // dicebear 风格，如 notionists
  language: string // 人设使用的语言，默认 zh
}

export interface AIAgentGroup {
  id: number
  name: string
  template: AIAgentGroupTemplate
  status: AIAgentGroupStatus
  total: number
  created: number
  error: string
  agentCount: number
  activeCount: number
  createdAt: string
}

// 人设工厂生成的一个人设
export interface AIAgentPreview {
  nickname: string
  archetype: string
  persona: string
  interests: string[] | null
  tone: string
  styleSamples: string[] | null
  dailyActions: number
}

// 导入导出文件中的一个 AI 用户：只含账号资料、类型与性格档案。文件内容为单个对象（一个 AI 用户）或对象数组（多个）
export interface AIAgentFileItem {
  username: string
  nickname: string
  avatarUrl: string
  backgroundUrl: string
  preferredColor: string
  tier: AIAgentTier
  profile?: Partial<AIAgentProfile> // 缺少的字段：新建时取该类型的默认值，更新已有 AI 用户时保持原值
}

// 导入时每一项的结果：create 为新建，update 为更新已有的同名 AI 用户；失败时只有 error
export interface ImportAIAgentResult {
  index: number
  action?: 'create' | 'update'
  agentId?: number // 试运行新建时没有
  error?: ApiErrorBody
}
