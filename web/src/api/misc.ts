import type { Category } from '@/models/category'
import type { BaseResponse } from '@/models/resp'
import type { User } from '@/models/user'
import type { SiteInfo } from '@/utils/common/siteinfo'
import { formatDataSize } from '@/utils/common/datasize'
import axiosClient from './client'

export async function getSiteInfo(): Promise<BaseResponse<SiteInfo>> {
  const res = await axiosClient.get<BaseResponse<SiteInfo>>('/misc/site-info')
  return res.data
}

export async function setSiteInfo(info: SiteInfo): Promise<BaseResponse<null>> {
  const res = await axiosClient.post<BaseResponse<null>>('/misc/site-info', info)
  return res.data
}

export async function getPublicConfig<T extends Record<string, unknown>>(
  defaults: T,
): Promise<BaseResponse<T>> {
  const keys = Object.keys(defaults)
  const res = await axiosClient.get<BaseResponse<Partial<T>>>('/misc/public-config', {
    params: { keys: keys.join(',') },
  })
  const result = { ...defaults } as T

  if (res.data.data) {
    for (const key in res.data.data) {
      if (res.data.data[key] !== undefined) {
        result[key] = res.data.data[key]
      }
    }
  }
  return {
    ...res.data,
    data: result,
  } as BaseResponse<T>
}

export async function setPublicConfig<T extends Record<string, unknown>>(
  config: T,
): Promise<BaseResponse<null>> {
  const res = await axiosClient.post<BaseResponse<null>>('/misc/public-config', config)
  return res.data
}

interface SitemapData {
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

export async function getSitemapData(): Promise<BaseResponse<SitemapData>> {
  const res = await axiosClient.get<BaseResponse<SitemapData>>('/misc/sitemap-data')
  return res.data
}

interface RssPostItem {
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

interface RssData {
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

export async function getRssData(): Promise<BaseResponse<RssData>> {
  const res = await axiosClient.get<BaseResponse<RssData>>('/misc/rss-data')
  return res.data
}

export type MetricsData = Record<string, number> & {
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

export const metricsHandler: Record<keyof MetricsData, (value: number) => string> = {
  uptime: value => value.toString(),
  goroutines: value => value.toString(),

  memoryTotalAlloc: value => formatDataSize({ size: value }),
  memorySys: value => formatDataSize({ size: value }),
  memoryLookups: value => value.toString(),
  memoryMallocs: value => value.toString(),
  memoryFrees: value => value.toString(),

  memoryHeapAlloc: value => formatDataSize({ size: value }),
  memoryHeapSys: value => formatDataSize({ size: value }),
  memoryHeapIdle: value => formatDataSize({ size: value }),
  memoryHeapInuse: value => formatDataSize({ size: value }),
  memoryHeapReleased: value => formatDataSize({ size: value }),
  memoryHeapObjects: value => value.toString(),

  memoryStackInuse: value => formatDataSize({ size: value }),
  memoryStackSys: value => formatDataSize({ size: value }),
  memoryMSpanInuse: value => formatDataSize({ size: value }),
  memoryMSpanSys: value => formatDataSize({ size: value }),
  memoryMCacheInuse: value => formatDataSize({ size: value }),
  memoryMCacheSys: value => formatDataSize({ size: value }),
  memoryBuckHashSys: value => formatDataSize({ size: value }),
  memoryGcSys: value => formatDataSize({ size: value }),
  memoryOtherSys: value => formatDataSize({ size: value }),

  gcNext: value => formatDataSize({ size: value }),
  gcLast: value => new Date(value).toLocaleString(),
  gcPauseTotalNs: value => `${(value / 1e6).toFixed(2)} ms`,
  gcNum: value => value.toString(),
  gcCpuFraction: value => `${(value * 100).toFixed(2)} %`,
  gcLastPauseNs: value => `${(value / 1e6).toFixed(2)} ms`,
}

export async function getMetrics<T extends MetricsData>(): Promise<BaseResponse<T>> {
  const res = await axiosClient.get<BaseResponse<T>>('/misc/metrics')
  return res.data
}
