'use client'

import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { isChunkLoadError, reloadForChunkError } from '@/utils/client/chunk-error'

// 构建时注入的版本（commit）；未注入（本地开发、未传构建参数）时不检查
// 必须使用全局 process：构建时只会内联全局 process.env.NEXT_PUBLIC_*，导入的 process 不会被替换
// eslint-disable-next-line node/prefer-global/process
const CURRENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION?.trim() ?? ''
const CHECK_INTERVAL_MS = 5 * 60 * 1000
const TOAST_ID = 'app-update-available'

/**
 * 部署新版本后提醒刷新：切回标签页时与每 5 分钟（仅在页面可见时）请求当前运行的版本，与本页面的版本不同则常驻提示
 * 另外，按需加载的代码块因新版本部署而加载失败时自动刷新一次
 */
export function AppUpdateChecker() {
  const t = useTranslations('AppUpdate')
  const pathname = usePathname()
  // 后台页面可能有未保存的内容，提示时额外提醒；用 ref 读取，避免切换页面时重新开始计时
  const isConsoleRef = useRef(false)
  isConsoleRef.current = !!pathname?.startsWith('/console')

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error) || /Failed to load chunk/i.test(event.message))
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

  useEffect(() => {
    if (!CURRENT_VERSION)
      return
    let notified = false
    let checking = false
    const check = async () => {
      if (notified || checking || document.visibilityState !== 'visible')
        return
      checking = true
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok)
          return
        const { version } = await res.json() as { version?: string }
        if (!version || version === CURRENT_VERSION)
          return
        notified = true
        toast.info(t('title'), {
          id: TOAST_ID,
          description: isConsoleRef.current ? t('description_console') : t('description'),
          duration: Infinity,
          closeButton: true,
          action: { label: t('refresh'), onClick: () => window.location.reload() },
        })
      }
      catch {
        // 检查失败（离线、部署中等）不影响当前页面，下次再试
      }
      finally {
        checking = false
      }
    }
    const onVisibilityChange = () => void check()
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [t])

  return null
}
