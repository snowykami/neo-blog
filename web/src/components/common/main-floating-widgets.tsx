'use client'

import dynamic from 'next/dynamic'
import Script from 'next/script'
import { useEffect, useState } from 'react'
import {
  activateMusicRuntime,
  hasDesktopIslandSession,
  useMusicPlayback,
  useMusicPlaylistSyncActive,
} from '@/contexts/music-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useDesktopIslandPrefs, useDesktopIslandRuntime } from '@/hooks/use-desktop-island-pref'
import { usePathname } from '@/i18n/navigation'
import { FloatingMusicBall, loadMusicPlayerModule } from './floating-music-ball'

const THIRD_PARTY_SCRIPT_SRC = 'https://cdn.liteyuki.org/js/cdn_info.js'

let desktopBridgePromise: Promise<typeof import('@/components/common/desktop-island-bridge')> | null = null

function loadDesktopIslandBridge() {
  desktopBridgePromise ??= import('@/components/common/desktop-island-bridge').catch((err) => {
    desktopBridgePromise = null
    throw err
  })
  return desktopBridgePromise
}

const ScrollToTopButton = dynamic(() => import('@/components/common/scroll-to-top'), { ssr: false })
const MusicPlayer = dynamic(
  () => loadMusicPlayerModule().then(m => m.MusicPlayer),
  { ssr: false },
)
const DesktopIslandBridge = dynamic(() => loadDesktopIslandBridge().then(m => m.DesktopIslandBridge), { ssr: false })

/** 首屏绘制完成、浏览器空闲后再挂载悬浮组件 */
function useIdleMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => setMounted(true), { timeout: 3000 })
      return () => window.cancelIdleCallback(id)
    }
    const timer = window.setTimeout(setMounted, 1200, true)
    return () => window.clearTimeout(timer)
  }, [])
  return mounted
}

// 全局悬浮组件
export function FloatingWidgets() {
  const { siteInfo } = useSiteInfo()
  const pathname = usePathname()
  const idleReady = useIdleMounted()
  const [scrolled, setScrolled] = useState(false)
  const { hasPlayed } = useMusicPlayback()
  const playlistSyncActive = useMusicPlaylistSyncActive()
  const desktopIslandPrefs = useDesktopIslandPrefs()
  const { reconnectEpoch } = useDesktopIslandRuntime()
  const [desktopSessionActive, setDesktopSessionActive] = useState(false)

  const isConsole = pathname?.startsWith('/console')
  const onMusicPage = pathname === '/music'
  const musicEnabled = Boolean(siteInfo.musicEnabled)

  useEffect(() => {
    if (scrolled || idleReady)
      return
    const onScroll = () => {
      if ((window.scrollY || document.documentElement.scrollTop || 0) > 60)
        setScrolled(true)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [idleReady, scrolled])

  useEffect(() => {
    if (!musicEnabled)
      return
    if (hasDesktopIslandSession())
      setDesktopSessionActive(true)
  }, [musicEnabled])

  // 导航进入 /music 页或设置页手动发起桌面灵动岛重连时激活控制器与歌单
  useEffect(() => {
    if (!musicEnabled)
      return
    if (onMusicPage || reconnectEpoch > 0)
      activateMusicRuntime({ syncPlaylist: true })
  }, [musicEnabled, onMusicPage, reconnectEpoch])

  const shouldSyncPlaylist = musicEnabled && (playlistSyncActive || hasPlayed) && (idleReady || onMusicPage)
  const shouldMountDesktopBridge = musicEnabled
    && desktopIslandPrefs.enabled
    && (hasPlayed || reconnectEpoch > 0 || (desktopSessionActive && idleReady))

  const quickNavPosition = musicEnabled
    ? 'right-[17px] bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:right-[25px] lg:bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))]'
    : 'right-4 bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] lg:right-8 lg:bottom-[calc(2rem+env(safe-area-inset-bottom,0px))]'

  return (
    <>
      {siteInfo.enableThirdPartyScript && !isConsole && <Script src={THIRD_PARTY_SCRIPT_SRC} strategy="lazyOnload" />}
      {(idleReady || scrolled) && <ScrollToTopButton positionClass={quickNavPosition} />}
      {musicEnabled && idleReady && <FloatingMusicBall />}
      {shouldSyncPlaylist && <MusicPlayer />}
      {shouldMountDesktopBridge && <DesktopIslandBridge />}
    </>
  )
}
