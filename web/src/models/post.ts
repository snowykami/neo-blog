import type { Category } from './category'
import type { User } from './user'
import type { Label } from '@/models/label'

/** 文章专属背景：字段含义与站点配置的 PageBackground 一致，可直接交给背景层 */
export interface PostBackground {
  image: string
  blur: number
  opacity: number
  veil: number
  veilColor: string
}

export interface Post {
  id: number
  // 可编辑字段
  title: string
  slug: string | null
  content: string
  description: string // 描述
  draftContent?: string | null // 草稿内容，仅单篇草稿模式（作者/管理员）返回，列表与随机接口不包含
  cover: string | null // 封面可以为空
  background: PostBackground | null // 文章专属背景，整段留空表示沿用全站背景
  category: Category | null // 分类可以为空
  categoryId: number | null // 分类 ID，可以为空
  labels: Label[] | null // 标签可以为空
  labelIds: number[] | null // 标签 ID 列表，可以为空
  type: 'markdown' | 'html' // 文章类型，markdown 或 html
  // 不可编辑字段
  user: User
  isLiked: boolean // 当前用户是否点赞
  isPrivate: boolean
  top: number
  likeCount: number
  commentCount: number
  viewCount: number
  heat: number
  createdAt: string
  updatedAt: string
  // AI 摘要相关（只读）
  descriptionByAi?: boolean // 当前描述为 AI 生成且未被修改
  aiSummaryStale?: boolean // 摘要生成后正文有更新，建议重新生成
  aiSummaryAt?: string | null // 摘要生成时间
  aiSummaryStatus?: 'queued' | 'running' | 'failed' // 生成任务状态，仅列表中有排队/进行中/失败的任务时返回
  aiSummaryError?: string // 最近一次生成失败的原因
}

export interface ListPostsParams {
  page?: number
  size?: number
  orderBy?: string
  desc?: boolean
  keywords?: string
}

// AI 摘要生成任务状态
export type AISummaryJobStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'

// 全站 AI 摘要的入队结果
export interface AISummaryBatchResult {
  queued: number // 本次加入队列的文章数
  skippedUpToDate: number // 摘要已是最新
  skippedManual: number // 描述为手动填写
  skippedEmpty: number // 正文为空
  skippedRunning: number // 已有任务在排队或生成中
}

export interface AISummaryStatus {
  status: AISummaryJobStatus
  error?: string
  description?: string
  stale: boolean
  generatedAt?: string | null
  configured: boolean // 是否已在全局配置中配置 AI
}
