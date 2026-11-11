import type { User } from './user'

// 错误报告：后端按指纹把错误事件聚合为问题（见后端 service.ErrorReportService）
export const ERROR_SOURCES = ['browser', 'server', 'backend'] as const
export type ErrorSource = (typeof ERROR_SOURCES)[number]
// 错误、页面进程崩溃、页面在后台被系统回收、其他消息
export const ERROR_KINDS = ['error', 'crash', 'discarded', 'message'] as const
export type ErrorKind = (typeof ERROR_KINDS)[number]
export const ERROR_STATUSES = ['unresolved', 'resolved', 'ignored'] as const
export type ErrorStatus = (typeof ERROR_STATUSES)[number]

export interface ErrorIssue {
  id: number
  source: ErrorSource
  kind: ErrorKind
  level: string
  title: string
  culprit: string
  status: ErrorStatus
  count: number
  lastRelease: string
  firstSeenAt: string
  lastSeenAt: string
  resolvedAt: string | null
}

export interface NamedCount {
  name: string
  count: number
}

export interface ErrorIssueDetail extends ErrorIssue {
  storedEvents: number
  visitors: number
  browsers: NamedCount[]
  os: NamedCount[]
  paths: NamedCount[]
}

export interface ErrorEventSummary {
  id: number
  issueId: number
  eventId: string
  level: string
  message: string
  path: string
  method: string
  release: string
  os: string
  osVersion: string
  browser: string
  browserVersion: string
  deviceType: string
  location: string
  visitorId: number | null
  anonymous: boolean
  createdAt: string
}

// 调用栈的一帧：浏览器的帧由 Next 服务端还原到源码位置（minified 为还原前的压缩位置）
export interface ErrorFrame {
  filename?: string
  absPath?: string
  function?: string
  lineno?: number
  colno?: number
  inApp?: boolean
  contextLine?: string
  preContext?: string[]
  postContext?: string[]
  minified?: string
}

export interface ErrorException {
  type: string
  value: string
  mechanism?: { type: string, handled?: boolean }
  stacktrace?: { frames: ErrorFrame[] }
}

export interface ErrorBreadcrumb {
  timestamp?: number
  category?: string
  message?: string
  level?: string
  type?: string
  data?: Record<string, unknown>
}

// 现场详情：各项按上报内容可能缺失
export interface ErrorEventDetailData {
  exception?: ErrorException[]
  breadcrumbs?: ErrorBreadcrumb[]
  contexts?: Record<string, Record<string, unknown>>
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  request?: { url?: string, method?: string, path?: string }
  sdk?: { name: string, version: string }
  environment?: string
  status?: number
  stackText?: string
  culpritFunction?: string
}

export interface ErrorEvent extends ErrorEventSummary {
  source: ErrorSource
  userAgent: string
  user: User | null
  detail: ErrorEventDetailData
}

export interface ErrorReportStats {
  unresolved: number
  activeLastDay: number
}
