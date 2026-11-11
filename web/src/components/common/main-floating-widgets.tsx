'use client'

import dynamic from 'next/dynamic'
import Script from 'next/script'
import { useEffect, useState } from 'react'
import ScrollToTopButton from '@/components/common/scroll-to-top'
import { useSiteInfo } from '@/contexts/site-info-context'
import { usePathname } from '@/i18n/navigation'

// 播放器体积不小（歌词引擎、封面取色、舞台特效），不挡首屏：空闲时再挂载，
// 功能不变——歌单加载与播放进度恢复照常执行，只比之前晚一两秒
const MusicPlayer = dynamic(() => import('./music-player').then(m => m.MusicPlayer), { ssr: false })

/** 首屏绘制完成、浏览器空闲后再挂载重组件 */
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

const THIRD_PARTY_SCRIPT_SRC = 'https://cdn.liteyuki.org/js/cdn_info.js'

// 全局悬浮组件
export function FloatingWidgets() {
  const { siteInfo } = useSiteInfo()
  const pathname = usePathname()
  const playerReady = useIdleMounted()
  // 第三方脚本仅在前台加载，且可在后台关闭；空闲时再加载，避免阻塞首屏
  const isConsole = pathname?.startsWith('/console')
  // 歌单只来自后台配置的网易云歌单：没配好（API 地址或歌单为空）时不挂载播放器，也不发任何歌单请求
  const musicEnabled = Boolean(siteInfo.musicEnabled)
  return (
    <>
      {siteInfo.enableThirdPartyScript && !isConsole && <Script src={THIRD_PARTY_SCRIPT_SRC} strategy="lazyOnload" />}
      <ScrollToTopButton positionClass="bottom-30 right-3 md:right-3 lg:right-12" />
      {/* 未配置歌单时不显示音乐播放器；空闲挂载，避免播放器进首屏关键路径 */}
      {musicEnabled && playerReady && <MusicPlayer />}
    </>
  )
}
