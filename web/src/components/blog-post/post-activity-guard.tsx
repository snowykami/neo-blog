'use client'

import type React from 'react'
import { useEffect, useInsertionEffect, useLayoutEffect, useRef, useState } from 'react'
import { getScrollOffset, getVisibleElementById } from '@/utils/client/dom'
import { postMemoryLru } from './post-memory-lru'

let popStateListenerAttached = false
let lastPopStateTime = -Infinity

function ensurePopStateListener() {
  if (popStateListenerAttached || typeof window === 'undefined')
    return
  popStateListenerAttached = true
  window.addEventListener('popstate', () => {
    lastPopStateTime = performance.now()
  }, { passive: true })
}

/**
 * 追踪文章在 React `<Activity>` 中的可见生命周期：
 * - 挂载或从 hidden 恢复为 visible 时，在绘制前（useLayoutEffect）同步登记为活跃并置入 LRU 队首；
 * - 被 `<Activity>` 隐藏或卸载时，解除活跃保护，超出窗口的旧隐藏文章随即释放重子树；
 * - 若通过带 `#hash` 的链接切回曾被 LRU 淘汰正文的缓存文章（非浏览器前进/后退），待正文同步重挂载后补齐锚点滚动定位。
 */
export function PostActivityTracker({ postId, bypass = false }: { postId: number, bypass?: boolean }) {
  const hasHiddenOnceRef = useRef(false)
  const pendingHashRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (bypass)
      return
    ensurePopStateListener()
    const wasEvicted = hasHiddenOnceRef.current && !postMemoryLru.isRetained(postId)
    const isPopState = typeof performance !== 'undefined' && performance.now() - lastPopStateTime < 500
    if (wasEvicted && !isPopState && typeof window !== 'undefined' && window.location.hash.length > 1)
      pendingHashRef.current = window.location.hash.slice(1)
    else
      pendingHashRef.current = null

    postMemoryLru.activate(postId)
    return () => {
      hasHiddenOnceRef.current = true
      pendingHashRef.current = null
      postMemoryLru.deactivate(postId)
    }
  }, [bypass, postId])

  useEffect(() => {
    if (bypass)
      return
    const rawHash = pendingHashRef.current
    pendingHashRef.current = null
    if (!rawHash)
      return

    let decoded = rawHash
    try {
      decoded = decodeURIComponent(rawHash)
    }
    catch {
      // 非法百分号编码保持原样匹配
    }

    const scrollToHashTarget = () => {
      const target = getVisibleElementById(decoded) ?? (decoded !== rawHash ? getVisibleElementById(rawHash) : null)
      if (!target)
        return false
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.scrollTo({
        top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - getScrollOffset()),
        behavior: reduced ? 'auto' : 'smooth',
      })
      return true
    }

    if (scrollToHashTarget())
      return

    const rafId = window.requestAnimationFrame(() => {
      scrollToHashTarget()
    })
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  })

  return null
}

/**
 * 包裹文章详情页中耗内存的重子树（正文 HTML/大图/代码高亮、组件岛、目录、灵动岛阅读传感器、评论区）：
 * - SSR 首屏与水合阶段始终完整渲染（100% 保持 SEO 与零水合差异）；
 * - 在最近访问 LRU 窗口内被 `<Activity>` 隐藏时保持挂载，实现毫秒级瞬切返回；
 * - 滑出 LRU 窗口且处于隐藏态时主动卸载内部 DOM 与已解码图片，可选保留最后测量的占位高度以防回退时滚动位置钳制；
 * - 再次切回该文章时，`useInsertionEffect` / `useLayoutEffect` 在浏览器首帧绘制前同步恢复挂载，无空白卡死。
 */
export function PostHeavySubtree({
  postId,
  bypass = false,
  preserveHeight = false,
  children,
}: {
  postId: number
  bypass?: boolean
  preserveHeight?: boolean
  children: React.ReactNode
}) {
  // 首次挂载完成前（SSR 与首屏水合阶段）始终渲染完整内容，避免水合不匹配与首屏二次重排；
  // 仅当文章至少经历过一次隐藏后，才允许在滑出 LRU 窗口时卸载重子树
  const [hasHiddenOnce, setHasHiddenOnce] = useState(false)
  const [retainedInLru, setRetainedInLru] = useState(true)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const lastHeightRef = useRef<number>(0)

  // 关键机制：React 19 `<Activity mode="hidden">` 会断开 Passive Effects（含 useSyncExternalStore）与 Layout Effects，
  // 且 Next.js 缓存的 Server Component 子树保持恒定 ReactElement 引用会触发父级 bailout；
  // 唯有 `useInsertionEffect` 在 `<Activity mode="hidden">` 期间保持连接并在 Fiber 真正卸载时清理，
  // 因此通过它在隐藏态监听 LRU 淘汰通知并触发 OffscreenLane 重渲染以真正卸载重子树。
  useInsertionEffect(() => {
    if (bypass)
      return
    return postMemoryLru.subscribe(() => {
      const next = postMemoryLru.isRetained(postId)
      setRetainedInLru(prev => (prev === next ? prev : next))
    })
  }, [bypass, postId])

  useLayoutEffect(() => {
    if (bypass)
      return
    // 从隐藏态切回可见态时，确保即便早于兄弟 Tracker 执行也立即同步恢复保留状态
    if (!postMemoryLru.isActive(postId))
      postMemoryLru.activate(postId)
    const next = postMemoryLru.isRetained(postId)
    setRetainedInLru(prev => (prev === next ? prev : next))
    return () => {
      if (preserveHeight && wrapperRef.current) {
        const measured = wrapperRef.current.offsetHeight
        if (measured > 0)
          lastHeightRef.current = measured
      }
      setHasHiddenOnce(true)
    }
  }, [bypass, postId, preserveHeight])

  const shouldRender = bypass || !hasHiddenOnce || retainedInLru

  // 可见期间持续记录最近一次有效布局高度（<Activity> 隐藏时自动 disconnect，零残留 ResizeObserver），
  // 避免隐藏提交阶段 display: none 先于 cleanup 生效时 offsetHeight 读到 0
  useEffect(() => {
    if (bypass || !preserveHeight || !shouldRender)
      return
    const el = wrapperRef.current
    if (!el)
      return
    const initial = el.offsetHeight
    if (initial > 0)
      lastHeightRef.current = initial
    if (typeof ResizeObserver === 'undefined')
      return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
        if (height > 0)
          lastHeightRef.current = Math.round(height)
      }
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [bypass, preserveHeight, shouldRender])

  if (!shouldRender) {
    if (!preserveHeight)
      return null
    return (
      <div
        aria-hidden="true"
        data-post-lru-evicted=""
        style={lastHeightRef.current > 0 ? { minHeight: `${lastHeightRef.current}px` } : undefined}
      />
    )
  }

  if (!preserveHeight)
    return <>{children}</>

  return <div ref={wrapperRef}>{children}</div>
}
