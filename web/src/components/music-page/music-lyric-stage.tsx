'use client'

import { RotateCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useMusic, useMusicClockStore } from '@/contexts/music-context'
import { useHdrEnabled } from '@/hooks/use-hdr-highlight'
import { LyricPlayer } from '@/lib/lyrics/lyric-player'
import { rhythmModelFor } from '@/lib/lyrics/rhythm/source'
import { cn } from '@/lib/utils'
import { lyricSourceLabel } from './lyric-source-badge'
import '@/lib/lyrics/lyric-player.css'
// 歌词字体的网页字体回退（只声明 @font-face，用到时才下载）
import '@/lib/lyrics/lyric-fonts'

/**
 * 播放器页的歌词舞台：歌词引擎（lib/lyrics/lyric-player.ts）的 React 包装。
 * 只负责创建 / 销毁引擎，并在歌词、显示选项、播放状态与进度变化时通知它；逐帧动画全部在引擎内完成，不触发 React 渲染。
 * compact 为紧凑模式（悬浮播放器、文章内单曲卡）：同一套引擎与样式，只缩小字号与间距；
 * strip 为单行条（导航栏标题、单曲卡收起时）：容器只有一行高、字号跟随容器，一次显示一行，超出宽度时跟随演唱横向滚动，不显示翻译与音译；
 * themed 时文字跟随站点亮暗主题（单曲卡），否则为深色界面上的白色文字；
 * stagePush 为播放器页副歌镜头推近时歌词区多放大的比例（由 MusicStageEffects 写入 scale）；
 * 读者开着 HDR 高光且屏幕支持 HDR 时，正在唱的歌词亮过 SDR 白（themed 时不启用，见 LyricPlayerDisplay.hdr）；
 * paused 时引擎停在此刻的画面、不再逐帧运行，恢复时直接跳到此刻的进度（见 LyricPlayer.setPaused）
 */
export function MusicLyricStage({ className, compact = false, strip = false, themed = false, stagePush, paused = false }: { className?: string, compact?: boolean, strip?: boolean, themed?: boolean, stagePush?: number, paused?: boolean }) {
  const t = useTranslations('MusicPlayer')
  const pageT = useTranslations('MusicPage')
  const hdr = useHdrEnabled() && !themed
  const { lyrics, lyricStatus, showTranslation, showRomaji, showLyricEffects, isPlaying, getAudio, seek, play, refreshLyrics, lyricSourcesPending, currentTrack } = useMusic()
  const clock = useMusicClockStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<LyricPlayer | null>(null)
  // 引擎每帧通过回调读取，不随渲染重建
  const isPlayingRef = useRef(isPlaying)
  const pausedRef = useRef(paused)
  const trackIdRef = useRef(currentTrack?.id ?? null)
  useEffect(() => {
    trackIdRef.current = currentTrack?.id ?? null
  }, [currentTrack?.id])
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
      strip,
      // 韵律动效：这首歌的节拍模型（分析完成前或不可用时为 null，回退到固定快慢）
      getRhythm: () => rhythmModelFor(trackIdRef.current),
    })
    player.setPaused(pausedRef.current)
    playerRef.current = player
    // 暂停时拖动进度条等也要刷新：随播放时钟（约每秒 4 次）唤醒，引擎自身在静止时会停止逐帧循环
    const unsubscribe = clock.subscribe(() => player.wake())
    return () => {
      unsubscribe()
      player.dispose()
      playerRef.current = null
    }
  }, [clock, compact, getAudio, hasLines, play, seek, strip])

  useEffect(() => {
    pausedRef.current = paused
    playerRef.current?.setPaused(paused)
  }, [paused])

  useEffect(() => {
    if (hasLines)
      playerRef.current?.setLyrics(lyrics)
  }, [hasLines, lyrics])

  // 底栏注明实际显示的歌词来源
  const sourceLabel = lyricSourceLabel(lyrics, pageT)
  const footerText = sourceLabel ? pageT('lyric_footer', { source: sourceLabel }) : ''
  useEffect(() => {
    // 单行条只有一行高，不显示翻译与音译
    playerRef.current?.setDisplay({ showTranslation: showTranslation && !strip, showRomanization: showRomaji && !strip, footerText, effects: showLyricEffects, hdr })
  }, [footerText, hasLines, hdr, showLyricEffects, showRomaji, showTranslation, strip])

  const colorStyle = themed ? { '--lyric-color': 'var(--foreground)' } as React.CSSProperties : undefined
  // 单行条：加载中留空，没有歌词时只注明纯音乐（不放重新获取的按钮）
  if (strip && !hasLines) {
    return (
      <div key="empty" className={cn('flex items-center truncate px-2.5 text-[color:var(--lyric-color,#fff)]', className)} style={colorStyle} aria-busy={lyricStatus === 'loading'}>
        {lyricStatus !== 'loading' && lyrics.instrumental ? t('pure_music_without_lyric') : null}
      </div>
    )
  }
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
      <div key="empty" className={cn('flex flex-col items-center justify-center', compact ? 'gap-2' : 'gap-4', className)}>
        <span className={cn('font-bold', themed ? 'text-muted-foreground' : 'text-white/40', compact ? 'text-sm' : 'text-2xl')}>
          {t(lyrics.instrumental ? 'pure_music_without_lyric' : 'no_lyric')}
        </span>
        {/* 获取失败时最常见的情况：直接在这里重新获取 */}
        <button
          type="button"
          onClick={refreshLyrics}
          disabled={lyricSourcesPending}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60',
            themed ? 'bg-muted text-muted-foreground hover:text-foreground' : 'bg-white/10 text-white/70 hover:bg-white/15 hover:text-white',
          )}
        >
          <RotateCwIcon aria-hidden className={cn('size-3.5', lyricSourcesPending && 'motion-safe:animate-spin')} />
          {pageT('lyric_refresh')}
        </button>
      </div>
    )
  }

  return (
    // 外层负责布局（className 会随页面状态变化，如移动端的封面 / 歌词切换）与上下渐隐遮罩；
    // 引擎挂在类名固定的内层上：引擎会给容器加 lyric-player 等类，若容器的 className 由 React 管理，
    // 重新渲染时会被覆盖，容器失去定位与裁切，歌词行铺满整页（两侧截断、盖住按钮导致点击穿透）
    <div
      key="stage"
      // 单行条嵌在链接（导航栏标题）里，只是其中的文字，不单独成区
      role={strip ? undefined : 'region'}
      aria-label={strip ? undefined : pageT('lyrics_region')}
      data-stage-push={stagePush}
      // 推近时单独成为合成层，缩放不重绘歌词
      className={cn(stagePush != null && 'will-change-[scale]', className)}
      // 单行条只有一行，不做上下渐隐
      style={strip
        ? colorStyle
        : {
            ...colorStyle,
            maskImage: 'linear-gradient(to bottom, transparent, black 10%, black 85%, transparent)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 10%, black 85%, transparent)',
          }}
    >
      {/* 节点由歌词引擎直接管理，React 不渲染任何子元素，也不改动它的类名 */}
      <div ref={containerRef} className="size-full" />
    </div>
  )
}
