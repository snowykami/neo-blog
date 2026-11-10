'use client'

import type { IslandActivity } from '@/contexts/topbar-island'
import { RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { IslandSlot, IslandText } from '@/components/layout/topbar-island/island-parts'
import { useIslandAccepts, useIslandActivity } from '@/contexts/topbar-island'
import { usePathname } from '@/i18n/navigation'
import { isChunkLoadError, reloadForChunkError } from '@/utils/client/chunk-error'

// 构建时注入的版本（commit）；未注入（本地开发、未传构建参数）时不检查
// 必须使用全局 process：构建时只会内联全局 process.env.NEXT_PUBLIC_*，导入的 process 不会被替换
// eslint-disable-next-line node/prefer-global/process
const CURRENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION?.trim() ?? ''
const CHECK_INTERVAL_MS = 5 * 60 * 1000
const TOAST_ID = 'app-update-available'
// 顶栏灵动岛里低于音乐与阅读进度：不急，读完再刷新也行
const ISLAND_PRIORITY = 30

/**
 * 部署新版本后提醒刷新：切回标签页时与每 5 分钟（仅在页面可见时）请求当前运行的版本，与本页面的版本不同则常驻提示
 * （前台开启了顶栏灵动岛的「新版本提示」时常驻在岛上，点按刷新；后台页面没有顶栏，仍用 toast）
 * 另外，按需加载的代码块因新版本部署而加载失败时自动刷新一次
 */
export function AppUpdateChecker() {
  const t = useTranslations('AppUpdate')
  const pathname = usePathname()
  // 后台页面可能有未保存的内容，提示时额外提醒；用 ref 读取，避免切换页面时重新开始计时
  const isConsoleRef = useRef(false)
  isConsoleRef.current = !!pathname?.startsWith('/console')
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const viaIsland = useIslandAccepts('update')

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
        setUpdateAvailable(true)
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

  // 发现新版本后：岛可用时常驻在岛上，否则（关闭、后台页面）常驻 toast；在两者之间切换页面时随之切换
  // 活动层（见 contexts/topbar-island.ts 文件头）：新版本要一直看得到，所以不打时长；点击时直接刷新
  const activity = useMemo<IslandActivity | null>(() => updateAvailable && viaIsland
    ? {
        id: 'update',
        feature: 'update',
        priority: ISLAND_PRIORITY,
        label: `${t('title')}: ${t('refresh')}`,
        compact: (
          <>
            <IslandSlot><RefreshCwIcon aria-hidden className="text-sky-400" /></IslandSlot>
            <IslandText>{t('title')}</IslandText>
            <IslandText className="shrink-0 text-white/60">{t('refresh')}</IslandText>
          </>
        ),
        minimal: <IslandSlot><RefreshCwIcon aria-hidden className="text-sky-400" /></IslandSlot>,
        onPress: () => window.location.reload(),
      }
    : null, [t, updateAvailable, viaIsland])
  useIslandActivity(activity)

  useEffect(() => {
    if (!updateAvailable)
      return
    if (viaIsland) {
      toast.dismiss(TOAST_ID)
      return
    }
    toast.info(t('title'), {
      id: TOAST_ID,
      description: isConsoleRef.current ? t('description_console') : t('description'),
      duration: Infinity,
      closeButton: true,
      action: { label: t('refresh'), onClick: () => window.location.reload() },
    })
  }, [t, updateAvailable, viaIsland])

  return null
}
