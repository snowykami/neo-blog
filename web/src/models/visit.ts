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
}
