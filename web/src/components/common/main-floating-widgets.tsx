'use client'

import { usePathname } from 'next/navigation'
import Script from 'next/script'
import ScrollToTopButton from '@/components/common/scroll-to-top'
import { useSiteInfo } from '@/contexts/site-info-context'
import { MusicPlayer } from './music-player'

const THIRD_PARTY_SCRIPT_SRC = 'https://cdn.liteyuki.org/js/cdn_info.js'

// 全局悬浮组件
export function FloatingWidgets() {
  const { siteInfo } = useSiteInfo()
  const pathname = usePathname()
  // 第三方脚本仅在前台加载，且可在后台关闭；空闲时再加载，避免阻塞首屏
  const isConsole = pathname?.startsWith('/console')
  return (
    <>
      {siteInfo.enableThirdPartyScript && !isConsole && <Script src={THIRD_PARTY_SCRIPT_SRC} strategy="lazyOnload" />}
      <ScrollToTopButton positionClass="bottom-30 right-3 md:right-3 lg:right-12" />
      {/* 未配置歌单时不显示音乐播放器 */}
      {siteInfo.musicPlaylistUrl && <MusicPlayer playlistUrl={siteInfo.musicPlaylistUrl} />}
    </>
  )
}
