import type { Category } from '@/models/category'
import type { User } from '@/models/user'

export interface SitemapData {
  baseUrl: string
  posts: {
    createdAt: string
    updatedAt: string
    slug: string
    id: number
  }[]
  editors: {
    id: number
    username: string
    updatedAt: string
  }[]
  categories: {
    id: number
    slug: string
    updatedAt: string
  }[]
  labels: {
    id: number
    slug: string
    updatedAt: string
    name: string
  }[]
  archives: string[]
}

export interface RssPostItem {
  id: number
  title: string
  slug: string
  content: string
  createdAt: string
  updatedAt: string
  user: User
  category: Category | null
  cover: string
}

export interface RssData {
  title: string
  description: string
  siteUrl: string // 网站链接
  feedUrl: string // RSS 链接
  // 次要信息
  author: string
  copyright: string
  imageUrl: string
  language: string
  pubDate: string // 最新文章更新时间
  // 额外字段
  postDefaultCover: string
  // 增量数据
  posts: RssPostItem[]
}

export type BackendMetricsData = Record<string, number> & {
  uptime: number
  goroutines: number

  memoryTotalAlloc: number // 所有被分配过的内存
  memorySys: number // 从操作系统获取的内存总量
  memoryLookups: number // 指针查找次数
  memoryMallocs: number // 分配的内存次数
  memoryFrees: number // 释放的内存次数

  memoryHeapAlloc: number // 堆上分配的内存
  memoryHeapSys: number // 从操作系统获取的堆内存总量
  memoryHeapIdle: number // 堆上空闲的内存
  memoryHeapInuse: number // 堆上正在使用的内存
  memoryHeapReleased: number // 返回给操作系统的内存
  memoryHeapObjects: number // 堆上分配的对象数

  memoryStackInuse: number // 栈上正在使用的内存
  memoryStackSys: number // 从操作系统获取的栈内存总量
  memoryMSpanInuse: number // MSpan结构占用的内存
  memoryMSpanSys: number // 从操作系统获取的MSpan结构内存总量
  memoryMCacheInuse: number // MCache结构占用的内存
  memoryMCacheSys: number // 从操作系统获取的MCache结构内存总量
  memoryBuckHashSys: number // 哈希表占用的内存
  memoryGcSys: number // 垃圾回收器占用内存
  memoryOtherSys: number // 其他内存占用

  gcNext: number // 下一次垃圾回收的内存目标
  gcLast: number // 上一次垃圾回收的时间
  gcPauseTotalNs: number // 垃圾回收总暂停时间
  gcNum: number // 垃圾回收次数
  gcCpuFraction: number // GC CPU占用比例
  gcLastPauseNs: number // 最近一次GC暂停时间，单位纳秒
}

/** 后端实例的核心指标：速率类指标按最近两次上报（15 秒）之间的增量计算 */
export interface BackendCoreMetrics {
  requestsPerSecond: number
  inflightRequests: number // 进行中的请求（含长连接）
  avgLatencyMs: number
  errorRate: number // 5xx 占比，0～1
  cpuPercent: number // 1 核 = 100
  memoryRss: number
  heapInuse: number
  goroutines: number
  dbInUse: number
  dbOpen: number
}

/** 前端实例的核心指标 */
export interface FrontendCoreMetrics {
  requestsPerSecond: number
  inflightRequests: number
  avgLatencyMs: number
  errorRate: number
  cpuPercent: number
  memoryRss: number
  heapUsed: number
  connections: number // 当前打开的 HTTP 连接
  eventLoopP99Ms: number
}

/** 一个后端实例的运行时指标快照 */
export interface RuntimeInstance {
  instanceId: string
  hostname: string // 容器部署时为容器 / Pod 名
  pid: number
  startedAt: string
  updatedAt: string // 快照时间；处理本次请求的实例为实时数据
  current: boolean // 是否为处理本次请求的实例
  core: BackendCoreMetrics
  requestsHistory: number[] // 最近若干次上报时的请求/秒，旧的在前
  metrics: BackendMetricsData
}


/** 一个前端实例的运行时指标快照 */
export interface FrontendInstance {
  instanceId: string
  hostname: string
  pid: number
  startedAt: string
  updatedAt: string
  core: FrontendCoreMetrics
  requestsHistory: number[]
  metrics: FrontendMetricsData
}

/** 数据库的运行统计；速率按最近两次采集（15 秒）之间的增量计算 */
export interface DatabaseMetrics {
  driver: string // postgres / sqlite
  version: string
  location: string // host:port/dbname 或 SQLite 文件路径
  error?: string
  maxConnections: number
  totalConnections: number // 服务器上全部客户端连接
  active: number // 以下为本站数据库中各状态的连接
  idleInTransaction: number
  idle: number
  waiting: number // 在等锁的连接
  longestQuerySeconds: number
  transactionsPerSecond: number
  transactionsHistory: number[]
  cacheHitRatio: number // 0～1
  rowsPerSecond: number
  sizeBytes: number
  walBytes: number
  deadlocksRecent: number // 近 10 分钟新增
  tempFilesRecent: number
  poolInUse: number
  poolOpen: number
}

/** 共享状态所在 Redis 的运行统计 */
export interface RedisMetrics {
  version: string
  location: string
  error?: string
  usedMemory: number
  maxMemory: number // 0 表示没有设置上限
  rss: number
  fragmentation: number
  opsPerSecond: number
  opsHistory: number[]
  clients: number
  blockedClients: number
  hitRatio: number // 0～1
  cpuPercent: number
  keys: number
  expiredPerSecond: number
  evictedPerMinute: number
  keyGroups: { group: string, count: number }[] // 本站的键按用途分组，数量多的在前
  keyGroupsComplete: boolean
}

/** 依赖服务（数据库与 Redis），每 15 秒由一个后端实例采集 */
export interface DependencyMetrics {
  updatedAt: string
  database: DatabaseMetrics | null
  redis: RedisMetrics | null // 未使用 Redis 时为空
}

/** 全部存活前后端实例的运行时指标；未配置 Redis 时只有本实例，前端没有配置 Redis 时 frontends 为空 */
export interface RuntimeMetrics {
  shared: boolean
  instances: RuntimeInstance[]
  frontends: FrontendInstance[]
  dependencies: DependencyMetrics | null // 启动后第一次采集前为空
}

/** 处理本次请求的前端实例；shared 表示它配置了 Redis（全部前端实例会出现在 RuntimeMetrics.frontends 中） */
export interface FrontendMetrics {
  shared: boolean
  instance: FrontendInstance
}

export type FrontendMetricsData = Record<string, number> & {
  uptime: number
  nodeVersion: number
  platform: number
  arch: number
  cpus: number

  loadavg1m: number
  loadavg5m: number
  loadavg15m: number

  memoryRss: number
  memoryHeapTotal: number
  memoryHeapUsed: number
  memoryExternal: number
  memoryArrayBuffers: number

  v8TotalHeapSize: number
  v8TotalHeapSizeExecutable: number
  v8TotalPhysicalSize: number
  v8TotalAvailableSize: number
  v8UsedHeapSize: number
  v8HeapSizeLimit: number
  v8MallocedMemory: number
  v8PeakMallocedMemory: number
  v8DoesZapGarbage: number

  cpuUserUsec: number
  cpuSystemUsec: number
}
