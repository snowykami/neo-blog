'use client'

import type { ComponentProps } from 'react'
import { useLocale } from 'next-intl'
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types'
import { useEffect, useRef } from 'react'
import { Link, useRouter } from '@/i18n/navigation'
import { localizePath } from '@/i18n/routing'

// 与 next.config.ts 中详情页 cacheLife.detail.stale (60s) 对齐，并配合 onInvalidate 与后台改内容通知主动清理
const PREFETCH_CACHE_TTL_MS = 60_000
const MAX_PREFETCHED_URLS = 150
// 短暂悬停意图阈值：快速滚屏扫过列表行（< 80ms）时在 onPointerLeave 中取消，仅对真实停顿悬停触发预取
const HOVER_INTENT_DELAY_MS = 80

const prefetchedEntries = new Map<string, number>()

function shouldPrefetchUrl(key: string, now = Date.now()): boolean {
  const cachedAt = prefetchedEntries.get(key)
  if (cachedAt !== undefined && now - cachedAt < PREFETCH_CACHE_TTL_MS) {
    prefetchedEntries.delete(key)
    prefetchedEntries.set(key, cachedAt)
    return false
  }
  return true
}

function markPrefetchedUrl(key: string, now = Date.now()) {
  prefetchedEntries.delete(key)
  prefetchedEntries.set(key, now)
  if (prefetchedEntries.size > MAX_PREFETCHED_URLS) {
    const oldest = prefetchedEntries.keys().next().value
    if (oldest !== undefined)
      prefetchedEntries.delete(oldest)
  }
}

export function clearHoverPrefetchCache() {
  prefetchedEntries.clear()
}

export const resetHoverPrefetchCacheForTests = clearHoverPrefetchCache

function resolveCacheKey(href: string, targetLocale: string): string {
  if (href.startsWith('?') && typeof window !== 'undefined')
    return `${window.location.pathname}${href}`
  return localizePath(href, targetLocale)
}

type HoverPrefetchLinkProps = Omit<ComponentProps<typeof Link>, 'prefetch' | 'unstable_dynamicOnHover'> & {
  href: string
  intentDelayMs?: number
}

/**
 * 列表卡片 / 归档条目专用链接：
 * - 显式关闭进入视口时的自动全量预取（prefetch={false}），消除打开列表页瞬间并发发出数十条 ?_rsc= 挤爆服务端队列的问题
 * - 鼠标悬停或键盘聚焦停顿超过阈值（默认 80ms）时以 PrefetchKind.FULL 按需完整预取一次（60s 去重且随 Segment Cache 失效自动联动清理）
 */
export function HoverPrefetchLink({
  href,
  locale,
  intentDelayMs = HOVER_INTENT_DELAY_MS,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  ...props
}: HoverPrefetchLinkProps) {
  const router = useRouter()
  const currentLocale = useLocale()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => clearTimer, [])

  const targetLocale = typeof locale === 'string' ? locale : currentLocale
  const opensInNewTab = props.target === '_blank'

  const schedulePrefetch = () => {
    if (opensInNewTab)
      return
    const cacheKey = resolveCacheKey(href, targetLocale)
    if (!shouldPrefetchUrl(cacheKey))
      return
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      const freshKey = resolveCacheKey(href, targetLocale)
      if (!shouldPrefetchUrl(freshKey))
        return
      markPrefetchedUrl(freshKey)
      try {
        router.prefetch(href, {
          ...(locale ? { locale } : {}),
          kind: PrefetchKind.FULL,
          onInvalidate: () => {
            prefetchedEntries.delete(freshKey)
          },
        })
      }
      catch {
        prefetchedEntries.delete(freshKey)
      }
    }, intentDelayMs)
  }

  return (
    <Link
      href={href}
      locale={locale}
      prefetch={false}
      unstable_dynamicOnHover={false}
      onPointerEnter={(event) => {
        onPointerEnter?.(event)
        if (event.pointerType === 'touch')
          return
        schedulePrefetch()
      }}
      onPointerLeave={(event) => {
        clearTimer()
        onPointerLeave?.(event)
      }}
      onFocus={(event) => {
        onFocus?.(event)
        if (event.currentTarget.matches?.(':focus-visible') === false)
          return
        schedulePrefetch()
      }}
      onBlur={(event) => {
        clearTimer()
        onBlur?.(event)
      }}
      {...props}
    />
  )
}
