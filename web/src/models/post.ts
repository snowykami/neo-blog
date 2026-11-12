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
  content: string // 正文 HTML；列表接口不返回（为空），摘要用 excerpt
  excerpt?: string // 已发布正文的纯文本摘要（最多 200 字，截断时带省略号），由后端保存时生成
  description: string // 描述
  draftContent?: string | null // 草稿内容，仅单篇草稿模式（作者/管理员）返回，列表与随机接口不包含
  draftVersion?: number // 草稿版本号，随草稿一起返回；保存正文时作为 baseDraftVersion 传回
  cover: string | null // 封面可以为空
  background: PostBackground | null // 文章专属背景，整段留空表示沿用全站背景
  contentTheme: string // 文章内容主题（正文排版），空表示跟随站点默认
  category: Category | null // 分类可以为空
  categoryId: number | null // 分类 ID，可以为空
  labels: Label[] | null // 标签可以为空
  labelIds: number[] | null // 标签 ID 列表，可以为空
  type: 'markdown' | 'html' // 文章类型，markdown 或 html
  // 不可编辑字段
  user: User
  isLiked: boolean // 当前用户是否点赞
  isPrivate: boolean
  // 置顶到首页（只有管理员可以设置）：pinned 为此刻是否置顶（已置顶且未到期），pinnedUntil 为空表示不自动取消
  pinned: boolean
  pinnedAt: string | null
  pinnedUntil: string | null
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
  // 搜索命中增强（仅 Meilisearch 列表检索命中时返回）
  searchSnippet?: string // 命中的正文裁剪片段
  highlightTerms?: string[] // 实际命中的原词（含拼音/容错反推的汉字或词元）
}

/** 首页最多同时置顶的文章数，与后端 service.MaxPinnedPosts 一致 */
export const PINNED_POSTS_LIMIT = 3

/**
 * 正文「文章引用」卡片的数据：只含卡片展示需要的字段，不含正文与草稿；
 * 当前用户看不到的文章（私密的、已删除的）不会返回
 */
/** 文章的计数：前台文章页按 ISR 缓存的是快照，浏览器进入页面后另取最新值（GET /post/p/:id/stats） */
export interface PostStats {
  viewCount: number
  likeCount: number
  commentCount: number
}

export interface PostCard {
  id: number
  slug: string | null
  title: string
  description: string
  cover: string
  category: Category | null
  user: User
  likeCount: number
  viewCount: number
  createdAt: string
  updatedAt: string
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
  visionFallback?: boolean // 开启了识图但模型拒收图片，本次按纯文本生成
  description?: string
  stale: boolean
  generatedAt?: string | null
  configured: boolean // 是否已在全局配置中配置 AI
}
