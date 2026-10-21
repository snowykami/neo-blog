import type { User } from './user'

export type VisitTargetType = 'post' | 'page' | 'other'
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

export interface VisitLog {
  id: number
  visitorId: number | null // 开启“请勿追踪”的访问为空
  visitCount: number
  user: User | null
  targetType: VisitTargetType
  targetId: number
  targetTitle: string
  targetSlug: string
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
