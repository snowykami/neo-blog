import type { CommentTarget } from './comment'
import type { User } from './user'

export type VisitTargetType = 'post' | 'page' | 'other'
// 行为类型：访问之外，点赞、评论等站内互动也记在同一条时间线
export type VisitAction = 'visit' | 'like' | 'comment'
// 其他页面的路由类型，见后端 service.describeVisitPath
export type VisitPathKind = 'home' | 'search' | 'label' | 'labels' | 'category' | 'categories' | 'archive' | 'user' | 'privacy' | 'other' | ''
export type VisitDeviceType = 'desktop' | 'mobile' | 'tablet' | 'bot' | ''
// 可信度结论：由浏览器信号、请求头与 IP 归属地的一致性检测得出，见后端 service/visit_trust.go
export type VisitTrust = 'trusted' | 'proxy' | 'spoofed' | 'bot' | 'unknown'
export const VISIT_TRUSTS: VisitTrust[] = ['trusted', 'proxy', 'spoofed', 'bot', 'unknown']
export type VisitSeverity = 'high' | 'medium' | 'low' | 'info'

// 访问上报附带的浏览器信号
export interface VisitSignals {
  timeZone: string
  utcOffset: number // 分钟，东正西负
  languages: string[]
  screen: string // 1920x1080（CSS 像素）
  dpr: number
  touchPoints: number
  pointer: 'fine' | 'coarse'
  colorScheme: 'light' | 'dark'
  webdriver: boolean
}

export interface Visitor {
  id: number
  user: User | null
  ip: string
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
  ip: string
  location: string
  os: string
  browser: string
  deviceType: VisitDeviceType
  createdAt: string
  // 一致性检测结果，旧记录与互动记录为空
  trust: VisitTrust | ''
  trustScore: number | null
  trustFlags: VisitTrustFlag[] // 命中的规则，按严重度从高到低
  ipCountry: string // IP 所在国家代码（港澳台单独区分）
  inferredCountry: string // 综合时区、语言、IP 推断的国家
  ipTrusted: boolean // IP 归属地与推断结果一致且不是机房网段
  language: string // 首选语言
  utcOffset: number | null
  engagedMs: number | null // 有效停留时长（毫秒），未收到时为空
  scrollDepth: number | null // 最大滚动深度（0-100）
}

export interface VisitTrustFlag {
  id: string
  severity: VisitSeverity
}

// 后台访问详情
export interface VisitDetail {
  visit: VisitLog
  signals: VisitSignalsDetail
  trust: VisitTrustResult | null // 互动记录为空
  history: VisitLog[] // 同一访客最近的访问
}

export interface VisitSignalsDetail {
  hasSignals: boolean
  userAgent: string
  acceptLanguage: string
  chPlatform: string
  chMobile: boolean | null
  chBrands: string
  isp: string
  datacenter: boolean
  prevCountry: string
  timeZone: string
  utcOffset: number | null
  languages: string[]
  screen: string
  dpr: number
  touchPoints: number | null
  pointer: string
  colorScheme: string
  webdriver: boolean
}

export interface VisitTrustResult {
  verdict: VisitTrust
  score: number | null
  country: string // 推断国家，无法推断时为空
  confidence: 'high' | 'medium' | 'low' | ''
  ipTrusted: boolean
  sources: VisitTrustSource[]
  rules: VisitRuleResult[]
}

// 地区推断的依据
export interface VisitTrustSource {
  key: 'ip' | 'tz' | 'lang'
  value: string
  country: string
  weight: number // 0 表示不参与
  note: string // 不参与的原因，见 Console.visits.trust.notes
  agree: boolean | null
}

// 一条规则的结果，说明文案按 reason 与 params 生成，见 Console.visits.trust.reasons
export interface VisitRuleResult {
  id: string
  category: 'location' | 'env' | 'auto'
  status: 'hit' | 'pass' | 'skip'
  severity: VisitSeverity | ''
  reason: string
  params: Record<string, string>
}

export interface NamedCount {
  name: string
  count: number
}

// 后台访客统计
export interface VisitInsights {
  days: number
  total: number // 含疑似自动化
  pv: number
  uv: number
  signalVisits: number // 带浏览器信号的访问
  verdicts: NamedCount[]
  trend: { label: string, counts: Partial<Record<VisitTrust, number>> }[] // 今日按小时（0-23），其余按天
  ipCountries: NamedCount[]
  inferredCountries: NamedCount[]
  proxyExits: NamedCount[]
  rules: NamedCount[]
  devices: NamedCount[]
  os: NamedCount[]
  browsers: NamedCount[]
  languages: NamedCount[]
  timeZones: NamedCount[]
  colorSchemes: NamedCount[]
  newVisitors: number // 首次访问在区间内
  returningVisitors: number
  engagement: VisitEngagement
  posts: VisitPostInsight[] // 文章阅读表现，按浏览量排序
  paths: { from: string, to: string, count: number }[] // 站内跳转路径
  outbound: NamedCount[] // 外链点击
  downloads: NamedCount[] // 文件下载
  vitals: WebVital[]
  slowPages: { path: string, p75: number, samples: number }[] // LCP 最慢的页面
}

// 阅读参与度汇总（不含疑似自动化）
export interface VisitEngagement {
  visits: number // 收到参与度数据的访问
  avgEngagedMs: number
  medianEngaged: number // 毫秒
  completed: number // 滚动深度达到 90%
  depthBuckets: NamedCount[] // 0-25 / 25-50 / 50-75 / 75-90 / 90-100
  avgScrollDepth: number
}

export interface VisitPostInsight {
  id: number
  title: string
  slug: string | null
  views: number
  engagedVisits: number
  avgEngagedMs: number
  avgScrollDepth: number
  completed: number
  likes: number // 区间内新增
  comments: number
  topSource: string // 主要外部来源
  topSourceHost: string
}

export type WebVitalName = 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB'

// 一项 Web Vitals 指标的 p75（CLS 无单位，其余为毫秒）与评级分布
export interface WebVital {
  name: WebVitalName
  samples: number
  p75: number
  good: number
  needsImprovement: number
  poor: number
  mobileP75: number | null
  desktopP75: number | null
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
