import type { BackendMetricsData, FrontendMetrics, FrontendMetricsData, RssData, RuntimeMetrics, SitemapData } from '@/models/misc'
import type { BaseResponse } from '@/models/resp'
import type { SiteInfo } from '@/utils/common/siteinfo'
import { camelToSnakeStr, snakeToCamelObj } from 'field-conv'
import { formatDataSize } from '@/utils/common/datasize'
import { formatDuration } from '@/utils/common/datetime'
import axiosClient from './client'

export async function getSiteInfo(): Promise<BaseResponse<SiteInfo>> {
  const res = await axiosClient.get('/misc/site-info')
  return res.data
}

export async function getPublicConfig<T extends Record<string, unknown>>(
  defaults: T,
): Promise<BaseResponse<T>> {
  // defaults 使用 camelCase 键（与响应转换后的键一致），请求时转换为后端的 snake_case 配置键
  const keys = Object.keys(defaults).map(camelToSnakeStr)
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

export async function getSitemapData(): Promise<BaseResponse<SitemapData>> {
  const res = await axiosClient.get<BaseResponse<SitemapData>>('/misc/sitemap-data')
  return res.data
}

export async function getRssData(): Promise<BaseResponse<RssData>> {
  const res = await axiosClient.get<BaseResponse<RssData>>('/misc/rss-data')
  return res.data
}

// 全部前后端实例的运行时指标（多副本时各实例每 15 秒把快照写进 Redis，处理本次请求的后端实例为实时数据）
export async function getRuntimeMetrics(): Promise<BaseResponse<RuntimeMetrics>> {
  const res = await axiosClient.get<BaseResponse<RuntimeMetrics>>('/misc/metrics')
  return res.data
}

// 处理本次请求的前端实例：前端没有配置 Redis 时，后台只能用它显示一个前端实例。接口返回 snake_case，在这里转换
export async function getFrontendMetrics(): Promise<FrontendMetrics> {
  const res = await fetch('/api/fe-metrics', { cache: 'no-store' })
  if (!res.ok)
    throw new Error(`HTTP ${res.status}`)
  return snakeToCamelObj(await res.json()) as FrontendMetrics
}

export const backendMetricsHandler: Record<keyof BackendMetricsData, (value: number) => string> = {
  uptime: value => formatDuration(Math.round(value / 1e6 / 1000)),
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
  gcLast: value => new Date(value / 1e6).toTimeString().split(' ')[0],
  gcPauseTotalNs: value => `${(value / 1e6).toFixed(2)} ms`,
  gcNum: value => value.toString(),
  gcCpuFraction: value => `${(value * 100).toFixed(2)} %`,
  gcLastPauseNs: value => `${(value / 1e6).toFixed(2)} ms`,
}

export const frontendMetricsHandler: Record<keyof FrontendMetricsData, (value: number) => string> = {
  uptime: value => formatDuration(Math.round(value)),
  nodeVersion: value => value.toString(),
  platform: value => value.toString(),
  arch: value => value.toString(),
  cpus: value => value.toString(),

  loadavg1m: value => `${value.toFixed(2)}%`,
  loadavg5m: value => `${value.toFixed(2)}%`,
  loadavg15m: value => `${value.toFixed(2)}%`,

  memoryRss: value => formatDataSize({ size: value }),
  memoryHeapTotal: value => formatDataSize({ size: value }),
  memoryHeapUsed: value => formatDataSize({ size: value }),
  memoryExternal: value => formatDataSize({ size: value }),
  memoryArrayBuffers: value => formatDataSize({ size: value }),

  v8TotalHeapSize: value => formatDataSize({ size: value }),
  v8TotalHeapSizeExecutable: value => formatDataSize({ size: value }),
  v8TotalPhysicalSize: value => formatDataSize({ size: value }),
  v8TotalAvailableSize: value => formatDataSize({ size: value }),
  v8UsedHeapSize: value => formatDataSize({ size: value }),
  v8HeapSizeLimit: value => formatDataSize({ size: value }),
  v8MallocedMemory: value => formatDataSize({ size: value }),
  v8PeakMallocedMemory: value => formatDataSize({ size: value }),
  v8DoesZapGarbage: value => (value ? 'true' : 'false'),

  cpuUserUsec: value => `${(value / 1e6).toFixed(2)} s`,
  cpuSystemUsec: value => `${(value / 1e6).toFixed(2)} s`,
}
