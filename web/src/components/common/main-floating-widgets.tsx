'use client'

import Script from 'next/script'
import ScrollToTopButton from '@/components/common/scroll-to-top'
import { MusicPlayer } from './music-player'
// 全局悬浮组件
export function FloatingWidgets() {
  return (
    <>
      <Script src="https://cdn.liteyuki.org/js/cdn_info.js" />
      <ScrollToTopButton positionClass="bottom-30 right-3 md:right-3 lg:right-12" />
      <MusicPlayer />
    </>
  )
}
