'use client'

import type { NextWebVitalsMetric } from 'next/app'
import { useReportWebVitals } from 'next/web-vitals'
import { MAX_WEB_VITAL_VALUE, trackWebVital } from '@/utils/client/analytics'

// 只上报 Core Web Vitals 与常用的加载指标
const METRICS = new Set(['LCP', 'INP', 'CLS', 'FCP', 'TTFB'])
const RATINGS = new Set(['good', 'needs-improvement', 'poor'])
const MAX_REPORTED_IDS = 200
const SESSION_SAMPLE_STORAGE_KEY = 'nb_wv_sample'

// 生产环境默认按会话采样 20%，本地 development 默认跳过（可通过环境变量或编程接口受控开启）
export const DEFAULT_PROD_WEB_VITALS_SAMPLE_RATE = 0.2
export const DEFAULT_DEV_WEB_VITALS_SAMPLE_RATE = 0

// 已上报的指标实例：开发模式下 effect 会执行两次，按指标 id 去重并限制上限防止长会话累积
const reported = new Set<string>()

let configuredSampleRate: number | null = null
let cachedSessionRoll: number | null = null

export function configureWebVitalsSampling(sampleRate: number | null) {
  configuredSampleRate = sampleRate === null ? null : Math.min(1, Math.max(0, sampleRate))
}

export function resolveWebVitalsSampleRate(envOverride?: { nodeEnv?: string, rawRate?: string }): number {
  if (configuredSampleRate !== null)
    return configuredSampleRate

  // eslint-disable-next-line node/prefer-global/process
  const rawRate = (envOverride?.rawRate ?? process.env.NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE ?? '').trim()
  if (rawRate !== '') {
    const parsed = Number(rawRate)
    if (Number.isFinite(parsed))
      return Math.min(1, Math.max(0, parsed))
  }

  // eslint-disable-next-line node/prefer-global/process
  const nodeEnv = envOverride?.nodeEnv ?? process.env.NODE_ENV
  if (nodeEnv === 'development')
    return DEFAULT_DEV_WEB_VITALS_SAMPLE_RATE

  return DEFAULT_PROD_WEB_VITALS_SAMPLE_RATE
}

export function shouldSampleWebVitalsSession(options?: {
  sampleRate?: number
  random?: () => number
}): boolean {
  const rate = options?.sampleRate !== undefined
    ? Math.min(1, Math.max(0, options.sampleRate))
    : resolveWebVitalsSampleRate()
  if (rate <= 0)
    return false
  if (rate >= 1)
    return true

  if (cachedSessionRoll === null) {
    let loaded: number | null = null
    if (typeof window !== 'undefined') {
      try {
        const stored = window.sessionStorage.getItem(SESSION_SAMPLE_STORAGE_KEY)
        if (stored !== null) {
          const parsed = Number(stored)
          if (Number.isFinite(parsed) && parsed >= 0 && parsed < 1)
            loaded = parsed
        }
      }
      catch {
        // 隐私模式或禁用存储时退回内存级会话随机值
      }
    }
    if (loaded === null) {
      const rand = options?.random ?? Math.random
      loaded = Math.min(0.999999, Math.max(0, rand()))
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.setItem(SESSION_SAMPLE_STORAGE_KEY, String(loaded))
        }
        catch {
          // 忽略写入失败
        }
      }
    }
    cachedSessionRoll = loaded
  }

  return cachedSessionRoll < rate
}

// 回调需保持同一引用，避免重复注册
export function reportWebVitalMetric(metric: NextWebVitalsMetric) {
  if (!METRICS.has(metric.name) || !('rating' in metric) || typeof metric.rating !== 'string' || !RATINGS.has(metric.rating))
    return
  if (!Number.isFinite(metric.value) || metric.value < 0 || metric.value > MAX_WEB_VITAL_VALUE || reported.has(metric.id))
    return
  if (!shouldSampleWebVitalsSession())
    return
  if (reported.size >= MAX_REPORTED_IDS) {
    const oldest = reported.values().next().value
    if (oldest !== undefined)
      reported.delete(oldest)
  }
  reported.add(metric.id)
  trackWebVital({ name: metric.name, value: metric.value, rating: metric.rating })
}

export function resetWebVitalsReporterForTests() {
  reported.clear()
  configuredSampleRate = null
  cachedSessionRoll = null
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(SESSION_SAMPLE_STORAGE_KEY)
    }
    catch {
      // 忽略存储清理异常
    }
  }
}

/** 页面性能（Web Vitals）上报：按会话采样后经 EventBatcher 批量缓冲提交 */
export function WebVitalsReporter() {
  useReportWebVitals(reportWebVitalMetric)
  return null
}
