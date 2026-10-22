import type { CommentTarget } from './comment'
import type { User } from './user'
import type { VisitSourceCount } from './visit'

// 统计区间：最近 7 / 30 天（含今天，按服务器时区）
export const DASHBOARD_DAYS = [7, 30] as const
export type DashboardDays = (typeof DASHBOARD_DAYS)[number]

// 本期与上期（紧邻的同长度区间）的数值，用于计算环比
export interface DashboardMetric {
  current: number
  previous: number
}

export interface DashboardSummary {
  pv: DashboardMetric // 访问次数
  uv: DashboardMetric // 独立访客
  comments: DashboardMetric // 新增评论（含回复）
  likes: DashboardMetric // 新增点赞（文章与评论）
  newUsers: DashboardMetric
  pendingComments: number // 区间内待回复的根评论
}

export interface DashboardTrendPoint {
  date: string // YYYY-MM-DD
  pv: number
  uv: number
  comments: number
  likes: number
}

export interface DashboardContent {
  posts: number
  publicPosts: number
  privatePosts: number
  draftPosts: number // 有尚未发布的修改
  pages: number
  aiSummaryReady: number
  aiSummaryStale: number // 正文修改后摘要已过期
  aiSummaryMissing: number
}

export interface DashboardPost {
  id: number
  title: string
  slug: string | null
  isPrivate: boolean
  hasDraft: boolean
  viewCount: number
  likeCount: number
  commentCount: number
  heat: number
  periodViews: number // 区间内访问次数，仅 top 列表有值
  createdAt: string
  updatedAt: string
}

export interface DashboardComment {
  id: number
  content: string // 已截断
  user: User | null
  target: CommentTarget | null // 所在文章/页面，已删除时为空
  depth: number
  replyCount: number
  isPrivate: boolean
  pending: boolean // 待回复：根评论、没有回复且不是作者本人发的
  createdAt: string
}

export interface Dashboard {
  totalPosts: number
  totalUsers: number
  totalComments: number
  totalViews: number
  totalFiles: number
  days: DashboardDays
  summary: DashboardSummary
  trend: DashboardTrendPoint[]
  content: DashboardContent
  sources: VisitSourceCount[] // 区间内来源排行（不含站内跳转）
  posts: {
    top: DashboardPost[] // 区间内浏览最多
    hot: DashboardPost[] // 累计热度最高
    recent: DashboardPost[] // 最近发布
    updated: DashboardPost[] // 最近更新
  }
  recentComments: DashboardComment[]
}
