'use client'

import type { VisitTargetType } from '@/models/visit'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePathname } from '@/i18n/navigation'
import { leavePageview, trackPageview } from '@/utils/client/analytics'

// 站内跳转时以上一个页面作为来源，首次进入时使用 document.referrer
let previousPath: string | null = null
// 最近一次已触发上报的页面标识，防止 StrictMode 双执行或平行路由切换过渡期重复挂载触发双倍 pageview
let lastReportedKey: string | null = null
// 当前挂载在活跃公开页面上的上报实例数；归零时清理活跃会话，避免 /console 或 /auth 误计停留时长或锁死回跳去重
let activeReporterCount = 0

export function matchesVisitPrefix(pathname: string, prefix: string): boolean {
  if (!prefix)
    return false
  if (prefix.endsWith('/'))
    return pathname.startsWith(prefix)
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function resetVisitReporterForTests() {
  previousPath = null
  lastReportedKey = null
  activeReporterCount = 0
}

// 仅用于订阅同路由下查询参数变化（如 / ↔ /?label=go）以唤醒父级 useEffect；
// 实际地址统一读取浏览器已完成提交的 window.location.search，避免跨路由切换时状态滞后或 %20/+ 编码差异
function VisitSearchBridge({ onChange }: { onChange: (signal: string) => void }) {
  const searchParams = useSearchParams()
  const signal = searchParams?.toString() ?? ''
  useLayoutEffect(() => {
    onChange(signal)
  }, [signal, onChange])
  return null
}

/**
 * 访问上报：页面在服务端渲染，后端拿不到访客的 IP 与 Cookie，因此由浏览器在路由变化后上报一次（见 utils/client/analytics）
 * - 文章/页面详情传入 targetType/targetId，其余页面只上报路径
 * - skipPrefixes 用于跳过由独立路由或详情页自行上报的路径
 * - transitPrefixes 用于标记中转路由（如 /random）：记录为下一跳 referrer 但本身不发请求
 * - allowPrefixes 用于限定仅在匹配路由下生效；ignoreSearch 用于忽略高频进度参数（如 /music?start=…）
 */
export function VisitReporter({
  targetType,
  targetId,
  skipPrefixes,
  transitPrefixes,
  allowPrefixes,
  ignoreSearch = false,
}: {
  targetType?: VisitTargetType
  targetId?: number
  skipPrefixes?: string[]
  transitPrefixes?: string[]
  allowPrefixes?: string[]
  ignoreSearch?: boolean
}) {
  const pathname = usePathname()
  const [searchSignal, setSearchSignal] = useState('')

  const targetIdentity = `${targetType ?? ''}:${targetId ?? ''}`
  const boundTargetRef = useRef(targetIdentity)
  // 详情页实例绑定目标对应的路径：Next 路由段 <Activity> 保活切换至其他详情页时，避免旧实例误响应新路径；
  // 若同一实例复用于新 targetId，则同步刷新绑定路径
  const boundDetailPathnameRef = useRef(targetId != null ? pathname : null)
  if (boundTargetRef.current !== targetIdentity) {
    boundTargetRef.current = targetIdentity
    boundDetailPathnameRef.current = targetId != null ? pathname : null
  }

  // 转为字符串作为依赖：调用方传入的字面量数组每次渲染都是新对象
  const skipKey = skipPrefixes?.join(',') ?? ''
  const transitKey = transitPrefixes?.join(',') ?? ''
  const allowKey = allowPrefixes?.join(',') ?? ''

  useEffect(() => {
    if (boundDetailPathnameRef.current !== null && pathname !== boundDetailPathnameRef.current)
      return
    if (allowKey && !allowKey.split(',').some(prefix => matchesVisitPrefix(pathname, prefix)))
      return

    const liveSearch = window.location.search
    const effectiveSearch = ignoreSearch ? '' : liveSearch

    // 中转路由（如 /random）：结算上一页参与度并记作下一跳来源以保留 SourceRandom，但不单独发上报请求
    if (transitKey && transitKey.split(',').some(prefix => matchesVisitPrefix(pathname, prefix))) {
      leavePageview()
      previousPath = `${window.location.pathname}${effectiveSearch}`
      lastReportedKey = null
      return
    }

    if (skipKey && skipKey.split(',').some(prefix => matchesVisitPrefix(pathname, prefix)))
      return

    activeReporterCount += 1
    const dedupKey = `${window.location.pathname}${effectiveSearch}|${targetType ?? ''}|${targetId ?? ''}`
    if (lastReportedKey !== dedupKey) {
      lastReportedKey = dedupKey
      // pathname 已去掉语言前缀（用于匹配前缀规则）；上报的是地址栏里的真实地址，带语言前缀（如 /en/p/x）
      const path = `${window.location.pathname}${ignoreSearch ? liveSearch : effectiveSearch}`
      const referrer = previousPath ? `${window.location.origin}${previousPath}` : document.referrer
      previousPath = ignoreSearch ? window.location.pathname : path
      trackPageview({ url: `${window.location.origin}${path}`, referrer, targetType, targetId })
        .catch(() => {
          // 上报失败不影响浏览
        })
    }

    return () => {
      activeReporterCount = Math.max(0, activeReporterCount - 1)
      queueMicrotask(() => {
        if (activeReporterCount === 0) {
          lastReportedKey = null
          leavePageview()
        }
      })
    }
  }, [pathname, searchSignal, ignoreSearch, targetType, targetId, skipKey, transitKey, allowKey])

  if (ignoreSearch)
    return null

  return (
    <Suspense fallback={null}>
      <VisitSearchBridge onChange={setSearchSignal} />
    </Suspense>
  )
}
