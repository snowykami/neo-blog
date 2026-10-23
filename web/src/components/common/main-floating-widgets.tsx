'use client'

import type { MusicSource } from '@/models/music'
import { usePathname } from 'next/navigation'
import Script from 'next/script'
import { useMemo } from 'react'
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
  // 歌单来源：网易云歌单由后端提供；静态来源未填写地址时为空
  const { musicSource: sourceType, musicPlaylistUrl } = siteInfo
  const musicSource = useMemo<MusicSource | null>(() => {
    if (sourceType === 'ncm')
      return { type: 'ncm' }
    return musicPlaylistUrl ? { type: 'static', url: musicPlaylistUrl } : null
  }, [sourceType, musicPlaylistUrl])
  return (
    <>
      {siteInfo.enableThirdPartyScript && !isConsole && <Script src={THIRD_PARTY_SCRIPT_SRC} strategy="lazyOnload" />}
      <ScrollToTopButton positionClass="bottom-30 right-3 md:right-3 lg:right-12" />
      {/* 未配置歌单时不显示音乐播放器 */}
      {musicSource && <MusicPlayer source={musicSource} />}
    </>
  )
}
