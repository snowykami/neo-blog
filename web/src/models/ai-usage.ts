// 全站模型调用用量（后台「系统运行」页的 AI 用量卡片）

// 调用用途：与后端 constant.LLMPurpose* 一致
export const AI_USAGE_PURPOSES = ['summary', 'writing', 'translation', 'lyric_annotation', 'ai_agent', 'ai_agent_memory', 'ai_agent_persona', 'other'] as const
export type AIUsagePurpose = (typeof AI_USAGE_PURPOSES)[number]

export interface AIUsagePurposeTotal {
  purpose: string
  calls: number
  failed: number
  promptTokens: number // 输入（含命中缓存的部分）
  cachedTokens: number // 输入中命中缓存的
  cacheWriteTokens: number // 写入缓存的
  completionTokens: number // 输出
  totalTokens: number // 输入 + 输出
}

export interface AIUsageSeries {
  purpose: string
  calls: number[] // 与 AIUsageStats.dates 一一对应
  tokens: number[]
}

export interface AIUsageStats {
  month: string // YYYY-MM（服务器时区）
  budget: number // 全站月度 token 预算，0 为不限
  monthTokens: number
  monthCalls: number
  agentBudget: number // AI 用户的月度 token 预算，0 为不限
  agentMonthTokens: number
  purposes: AIUsagePurposeTotal[]
  dates: string[] // 近 30 天，YYYY-MM-DD
  series: AIUsageSeries[]
}
