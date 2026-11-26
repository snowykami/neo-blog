'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { usePathname } from '@/i18n/navigation'
import { CHUNK_LOAD_MESSAGE_RE, isChunkLoadError, reloadForChunkError } from '@/utils/client/chunk-error'

const LazyToaster = dynamic(
  () => import('@/components/ui/sonner').then(m => m.Toaster),
  { ssr: false },
)

const LazyAppUpdateChecker = dynamic(
  () => import('@/components/common/app-update-checker').then(m => m.AppUpdateChecker),
  { ssr: false },
)

const LazyLocaleSuggestToast = dynamic(
  () => import('@/components/common/locale-suggest-toast').then(m => m.LocaleSuggestToast),
  { ssr: false },
)

const LazyFloatingWidgets = dynamic(
  () => import('@/components/common/main-floating-widgets').then(m => m.FloatingWidgets),
  { ssr: false },
)

/**
 * 首屏 FCP / LCP 绘制完成（浏览器进入空闲或用户发生任意首次交互）后再触发非首屏附属模块的动态下载，
 * 避免水合瞬间并发拉取 Popover / FloatingUI / 悬浮球 / 语言提示等 chunk 计入移动端首屏 unused-javascript
 */
function useDeferredClientReady(immediate = false): boolean {
  const [ready, setReady] = useState(immediate)
  useEffect(() => {
    if (ready)
      return
    let done = false
    const activate = () => {
      if (done)
        return
      done = true
      setReady(true)
    }

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'touchstart', 'keydown', 'scroll']
    for (const evt of events)
      window.addEventListener(evt, activate, { once: true, passive: true })

    let idleId: number | undefined
    let timerId: number | undefined
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(activate, { timeout: 2500 })
    }
    else {
      timerId = window.setTimeout(activate, 1200)
    }

    return () => {
      for (const evt of events)
        window.removeEventListener(evt, activate)
      if (idleId !== undefined && typeof window.cancelIdleCallback === 'function')
        window.cancelIdleCallback(idleId)
      if (timerId !== undefined)
        window.clearTimeout(timerId)
    }
  }, [ready])
  return ready
}

export function DeferredToaster() {
  return <LazyToaster richColors position="top-center" offset={80} />
}

/**
 * 同步保留极轻量的 ChunkLoadError 兜底监听（防止滚动更新期间异步 chunk 加载失败漏捕获），
 * 其余版本轮询、灵动岛通知与 toast 逻辑在空闲后拆入异步 chunk
 */
export function DeferredAppUpdateChecker() {
  const ready = useDeferredClientReady()
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error) || CHUNK_LOAD_MESSAGE_RE.test(event.message))
        reloadForChunkError()
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason))
        reloadForChunkError()
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return ready ? <LazyAppUpdateChecker /> : null
}

export function DeferredLocaleSuggestToast() {
  const ready = useDeferredClientReady()
  return ready ? <LazyLocaleSuggestToast /> : null
}

export function DeferredFloatingWidgets() {
  const pathname = usePathname()
  const ready = useDeferredClientReady(pathname === '/music')
  return ready ? <LazyFloatingWidgets /> : null
}
