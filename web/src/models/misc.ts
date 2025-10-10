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
  pudDate: string
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
