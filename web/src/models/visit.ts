import type { CommentTarget } from './comment'
import type { User } from './user'

export type VisitTargetType = 'post' | 'page' | 'other'
// 行为类型：访问之外，点赞、评论等站内互动也记在同一条时间线
export type VisitAction = 'visit' | 'like' | 'comment'
// 其他页面的路由类型，见后端 service.describeVisitPath
export type VisitPathKind = 'home' | 'search' | 'label' | 'labels' | 'category' | 'categories' | 'archive' | 'user' | 'privacy' | 'other' | ''
export type VisitDeviceType = 'desktop' | 'mobile' | 'tablet' | 'bot' | ''

export interface Visitor {
  id: number
  user: User | null
  ip: string // 已脱敏
  location: string
  os: string
  browser: string
  deviceType: VisitDeviceType
  visitCount: number
  firstSeenAt: string
  lastSeenAt: string
}

// 互动涉及的评论摘要
export interface VisitComment {
  id: number
  content: string // 已截断
}

export interface VisitLog {
  id: number
  visitorId: number | null // 开启“请勿追踪”的访问与互动记录为空
  visitCount: number
  user: User | null // 访问者或执行互动的用户
  action: VisitAction
  targetType: VisitTargetType | 'comment' // 互动目标为评论时为 comment（点赞评论或回复）
  targetId: number
  targetUser: User | null // 被互动内容的作者
  subject: CommentTarget | null // 所在文章/页面（目标为评论时为评论所在的文章/页面），已删除时为空
  targetComment: VisitComment | null // 被点赞或被回复的评论
  comment: VisitComment | null // 评论/回复时新发表的评论
  pathKind: VisitPathKind
  pathName: string // 标签名、分类名、用户昵称或搜索词
  path: string
  referrer: string
  source: string // 来源分类：direct / internal / external / google、github 等，见后端 utils.ClassifyReferrer
  sourceHost: string // 来源域名，直接访问时为空
  ip: string // 已脱敏
  location: string
  os: string
  browser: string
  deviceType: VisitDeviceType
  createdAt: string
}

export interface VisitStats {
  todayPv: number
  todayUv: number
  todayUserVisits: number
  totalVisitors: number
  todaySources: VisitSourceCount[] // 今日来源排行（不含站内跳转）
}

export interface VisitSourceCount {
  source: string
  host: string // 仅其他网站（external）按域名区分
  count: number
}
