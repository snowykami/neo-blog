'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useMusic, useMusicClockStore } from '@/contexts/music-context'
import { LyricPlayer } from '@/lib/lyrics/lyric-player'
import { cn } from '@/lib/utils'
import { lyricSourceLabelKey } from './lyric-source-badge'
import '@/lib/lyrics/lyric-player.css'

/**
 * 播放器页的歌词舞台：歌词引擎（lib/lyrics/lyric-player.ts）的 React 包装。
 * 只负责创建 / 销毁引擎，并在歌词、显示选项、播放状态与进度变化时通知它；逐帧动画全部在引擎内完成，不触发 React 渲染。
 * compact 为紧凑模式（悬浮播放器、文章内单曲卡）：同一套引擎与样式，只缩小字号与间距；
 * themed 时文字跟随站点亮暗主题（单曲卡），否则为深色界面上的白色文字
 */
export function MusicLyricStage({ className, compact = false, themed = false }: { className?: string, compact?: boolean, themed?: boolean }) {
  const t = useTranslations('MusicPlayer')
  const pageT = useTranslations('MusicPage')
  const { lyrics, lyricStatus, showTranslation, showRomaji, showLyricEffects, isPlaying, getAudio, seek, play } = useMusic()
  const clock = useMusicClockStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<LyricPlayer | null>(null)
  // 引擎每帧通过回调读取，不随渲染重建
  const isPlayingRef = useRef(isPlaying)
  const hasLines = lyricStatus !== 'loading' && lyrics.lines.length > 0

  useEffect(() => {
    isPlayingRef.current = isPlaying
    playerRef.current?.wake()
  }, [isPlaying])

  useEffect(() => {
    const container = containerRef.current
    if (!hasLines || !container)
      return
    const player = new LyricPlayer(container, {
      getTime: () => getAudio()?.currentTime ?? null,
      isPlaying: () => isPlayingRef.current,
      onSeek: (timeMs) => {
        seek(timeMs / 1000)
        play()
      },
      compact,
    })
    playerRef.current = player
    // 暂停时拖动进度条等也要刷新：随播放时钟（约每秒 4 次）唤醒，引擎自身在静止时会停止逐帧循环
    const unsubscribe = clock.subscribe(() => player.wake())
    return () => {
      unsubscribe()
      player.dispose()
      playerRef.current = null
    }
  }, [clock, compact, getAudio, hasLines, play, seek])

  useEffect(() => {
    if (hasLines)
      playerRef.current?.setLyrics(lyrics)
  }, [hasLines, lyrics])

  // 底栏注明实际显示的歌词来源
  const sourceKey = lyricSourceLabelKey(lyrics.source)
  const footerText = sourceKey ? pageT('lyric_footer', { source: pageT(sourceKey) }) : ''
  useEffect(() => {
    playerRef.current?.setDisplay({ showTranslation, showRomanization: showRomaji, footerText, effects: showLyricEffects })
  }, [footerText, hasLines, showLyricEffects, showRomaji, showTranslation])

  if (lyricStatus === 'loading') {
    return (
      // key：三种状态是不同的元素，React 不会复用交给引擎管理的容器
      <div key="loading" className={cn('grid content-center', compact ? 'gap-2.5 px-2' : 'gap-5', className)} aria-busy>
        {['w-3/4', 'w-1/2', 'w-2/3', 'w-2/5'].map(width => <Skeleton key={width} className={cn(compact ? 'h-4' : 'h-9', !themed && 'bg-white/10', width)} />)}
      </div>
    )
  }
  if (!hasLines) {
    return (
      <div key="empty" className={cn('flex items-center justify-center font-bold', themed ? 'text-muted-foreground' : 'text-white/40', compact ? 'text-sm' : 'text-2xl', className)}>
        {t(lyrics.instrumental ? 'pure_music_without_lyric' : 'no_lyric')}
      </div>
    )
  }

  return (
    // 外层负责布局（className 会随页面状态变化，如移动端的封面 / 歌词切换）与上下渐隐遮罩；
    // 引擎挂在类名固定的内层上：引擎会给容器加 lyric-player 等类，若容器的 className 由 React 管理，
    // 重新渲染时会被覆盖，容器失去定位与裁切，歌词行铺满整页（两侧截断、盖住按钮导致点击穿透）
    <div
      key="stage"
      role="region"
      aria-label={pageT('lyrics_region')}
      className={className}
      style={{
        ...(themed && { '--lyric-color': 'var(--foreground)' } as React.CSSProperties),
        maskImage: 'linear-gradient(to bottom, transparent, black 10%, black 85%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 10%, black 85%, transparent)',
      }}
    >
      {/* 节点由歌词引擎直接管理，React 不渲染任何子元素，也不改动它的类名 */}
      <div ref={containerRef} className="size-full" />
    </div>
  )
}
