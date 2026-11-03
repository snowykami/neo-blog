'use client'

import type { NextWebVitalsMetric } from 'next/app'
import { useReportWebVitals } from 'next/web-vitals'
import { trackWebVital } from '@/utils/client/analytics'

// 只上报 Core Web Vitals 与常用的加载指标
const METRICS = new Set(['LCP', 'INP', 'CLS', 'FCP', 'TTFB'])

// 已上报的指标实例：开发模式下 effect 会执行两次，按指标 id 去重
const reported = new Set<string>()

// 回调需保持同一引用，避免重复注册
function report(metric: NextWebVitalsMetric) {
  if (!METRICS.has(metric.name) || !('rating' in metric) || typeof metric.rating !== 'string' || reported.has(metric.id))
    return
  reported.add(metric.id)
  trackWebVital({ name: metric.name, value: metric.value, rating: metric.rating })
}

/** 页面性能（Web Vitals）上报：使用 Next.js 内置的 useReportWebVitals 采集 */
export function WebVitalsReporter() {
  useReportWebVitals(report)
  return null
}
