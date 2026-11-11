'use client'

import type { IslandActivity } from '@/contexts/topbar-island'
import { RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { IslandSlot, IslandText } from '@/components/layout/topbar-island/island-parts'
import { useIslandAccepts, useIslandActivity } from '@/contexts/topbar-island'
import { usePathname } from '@/i18n/navigation'
import { CURRENT_APP_VERSION, isChunkLoadError, isNewVersionDeployed, reloadForChunkError } from '@/utils/client/chunk-error'

const CHECK_INTERVAL_MS = 5 * 60 * 1000
// 页面内跳转时顺带检查的最小间隔：连续翻页不用每次都问
const NAVIGATION_CHECK_INTERVAL_MS = 30 * 1000
// 发现新版本后一直没有跳转（停在同一页阅读）多久才显示提醒
const PROMPT_AFTER_IDLE_MS = 10 * 60 * 1000
const PROMPT_RECHECK_MS = 15 * 1000
const TOAST_ID = 'app-update-available'
// 顶栏灵动岛里低于音乐与阅读进度：不急，读完再刷新也行
const ISLAND_PRIORITY = 30

/** 正在播放音乐（播放器通过 MediaSession 标明播放状态；本组件在音乐上下文之外，所以不读上下文） */
function isMusicPlaying() {
  return typeof navigator !== 'undefined' && navigator.mediaSession?.playbackState === 'playing'
}

/**
 * 是否可以把这次点击改成整页加载（悄悄升级）：普通左键点击站内链接，不是新标签页、下载、同页锚点，也不涉及后台
 * （后台可能有未保存的内容，整页加载会触发离开确认）
 */
function upgradeTarget(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return null
  const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download'))
    return null
  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin || url.pathname.includes('/console') || url.pathname.startsWith('/api/'))
    return null
  if (url.pathname === window.location.pathname && url.search === window.location.search)
    return null
  return url.href
}

/**
 * 部署新版本后的升级（参考 Discourse 的做法：在自然的时机悄悄升级，尽量不打扰）：
 * - 发现：页面可见时每 5 分钟、切回标签页时、页面内跳转时（至少隔 30 秒）请求服务器版本，只有更新的版本才算（见 isNewVersionDeployed）
 * - 待升级：没在放音乐时，下一次点击站内链接改为整页加载，直接换上新版本，不提示
 * - 提醒：正在放音乐（整页加载会打断播放）、在后台页面、或停在同一页超过 10 分钟没有跳转时，才常驻提醒，由读者决定何时刷新
 *   （前台开启了顶栏灵动岛的「新版本提示」时在岛上，点按刷新；后台页面没有顶栏，仍用 toast）
 * 另外，按需加载的代码块因新版本部署而加载失败时自动刷新一次
 */
export function AppUpdateChecker() {
  const t = useTranslations('AppUpdate')
  const pathname = usePathname()
  // 后台页面可能有未保存的内容，提示时额外提醒；用 ref 读取，避免切换页面时重新开始计时
  const isConsoleRef = useRef(false)
  isConsoleRef.current = !!pathname?.startsWith('/console')
  // 服务器上有更新的版本（待升级）与是否显示提醒
  const [pendingSince, setPendingSince] = useState<number | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const viaIsland = useIslandAccepts('update')
  const checkRef = useRef<() => Promise<void>>(async () => {})

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

  // 发现新版本：定时、切回标签页、页面内跳转时检查
  useEffect(() => {
    if (!CURRENT_APP_VERSION)
      return
    let found = false
    let checking = false
    let lastCheckAt = 0
    const check = async () => {
      if (found || checking || document.visibilityState !== 'visible')
        return
      checking = true
      lastCheckAt = Date.now()
      // 检查失败（离线、部署中等）视为没有新版本，不影响当前页面，下次再试
      if (await isNewVersionDeployed()) {
        found = true
        setPendingSince(Date.now())
      }
      checking = false
    }
    checkRef.current = async () => {
      if (Date.now() - lastCheckAt >= NAVIGATION_CHECK_INTERVAL_MS)
        await check()
    }
    const onVisibilityChange = () => void check()
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  // 页面内跳转时顺带检查（首次渲染不算跳转）；有待升级时，跳转也说明读者没有停在同一页，重新计算停留时间
  const firstPathRef = useRef(true)
  useEffect(() => {
    if (firstPathRef.current) {
      firstPathRef.current = false
      return
    }
    void checkRef.current()
    setPendingSince(since => since == null ? since : Date.now())
  }, [pathname])

  // 待升级：没在放音乐时，下一次点击站内链接改为整页加载
  useEffect(() => {
    if (pendingSince == null)
      return
    const onClick = (event: MouseEvent) => {
      if (isMusicPlaying() || isConsoleRef.current)
        return
      const href = upgradeTarget(event)
      if (!href)
        return
      event.preventDefault()
      event.stopPropagation()
      window.location.assign(href)
    }
    // 捕获阶段：赶在 Next 的 Link 做客户端跳转之前
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [pendingSince])

  // 待升级时什么情况下显示提醒：正在放音乐、在后台页面、或停在同一页太久
  useEffect(() => {
    if (pendingSince == null || updateAvailable)
      return
    const evaluate = () => {
      if (isMusicPlaying() || isConsoleRef.current || Date.now() - pendingSince >= PROMPT_AFTER_IDLE_MS)
        setUpdateAvailable(true)
    }
    evaluate()
    const timer = window.setInterval(evaluate, PROMPT_RECHECK_MS)
    return () => window.clearInterval(timer)
  }, [pendingSince, updateAvailable])

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
