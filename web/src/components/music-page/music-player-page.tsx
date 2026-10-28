'use client'

import type { MusicTrack } from '@/models/music'
import { ArrowLeftIcon, Disc3Icon, MicVocalIcon, MusicIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { MarqueeText } from '@/components/common/marquee-text'
import { SafeImage } from '@/components/common/safe-image'
import { VisitReporter } from '@/components/common/visit-reporter'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { useMusic } from '@/contexts/music-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { cn } from '@/lib/utils'
import { LyricAnnotationRefresh } from './lyric-annotation-refresh'
import { LyricSourceBadge } from './lyric-source-badge'
import { MusicBackground } from './music-background'
import { MusicLyricMoments } from './music-lyric-moments'
import { MusicLyricStage } from './music-lyric-stage'
import { MusicPageControls } from './music-page-controls'
import { MusicPlaylistSheet } from './music-playlist-sheet'
import { MusicStageEffects } from './music-stage-effects'
import { useCoverAccent } from './use-cover-accent'
import { useMusicHotkeys } from './use-music-hotkeys'
import { useMusicShareUrl } from './use-music-share-url'

// 播放器页固定为深色沉浸式界面：主色换成白色，进度条、焦点环等与白色文字协调
const PAGE_STYLE = { '--primary': 'oklch(0.97 0 0)', '--primary-foreground': 'oklch(0.2 0 0)' } as React.CSSProperties

/** 封面与曲目信息：暂停时封面略微缩小（与播放状态呼应） */
function TrackHero({ track, playing, onCoverClick, className }: { track: MusicTrack, playing: boolean, onCoverClick: () => void, className?: string }) {
  const t = useTranslations('MusicPage')
  return (
    <div className={cn('flex min-h-0 flex-col justify-center gap-6', className)}>
      <button
        type="button"
        aria-label={t('show_lyrics')}
        onClick={onCoverClick}
        // 只有移动端可以点封面切换到歌词视图；移动端同时受宽度与高度约束，避免矮屏上把控制栏挤出屏幕
        className="relative mx-auto aspect-square w-[min(80vw,46dvh)] shrink-0 overflow-hidden rounded-2xl bg-white/10 shadow-2xl transition-transform duration-500 ease-out lg:pointer-events-none lg:w-full lg:max-w-[26rem]"
        style={{ transform: playing ? 'scale(1)' : 'scale(0.92)' }}
      >
        {track.albumPic
          ? <SafeImage src={track.albumPic} alt={track.album} fill priority sizes="(min-width: 1024px) 416px, 72vw" className="object-cover" />
          : <MusicIcon aria-hidden className="absolute inset-0 m-auto size-16 text-white/40" />}
      </button>
      <div className="grid min-w-0 gap-1 text-center lg:text-left">
        {/* 歌名与歌手过长时以跑马灯滚动（跑马灯内部是块级元素，标题用 role="heading" 而不是 h1）；key：切歌时从头滚动 */}
        <div role="heading" aria-level={1} className="min-w-0">
          <MarqueeText key={`name-${track.id}`} className="text-2xl font-bold text-white">
            {track.name}
            {track.aliases.length > 0 && <span className="ml-2 text-lg font-medium text-white/50">{`(${track.aliases.join(', ')})`}</span>}
          </MarqueeText>
        </div>
        <MarqueeText key={`artist-${track.id}`} className="text-base text-white/65">
          {[track.artists.join(' / '), track.album].filter(Boolean).join(' · ')}
        </MarqueeText>
        <div className="mt-1 flex items-center gap-1.5 justify-self-center lg:justify-self-start">
          <LyricSourceBadge />
          <LyricAnnotationRefresh />
        </div>
      </div>
    </div>
  )
}

/** 歌单未配置、加载中或加载失败时的占位 */
function PlayerPlaceholder({ state }: { state: 'not_configured' | 'loading' | 'failed' }) {
  const t = useTranslations('MusicPage')
  if (state === 'loading')
    return <Spinner className="m-auto size-8 text-white/70" aria-label={t('loading')} />
  return (
    <Empty className="m-auto border-0 bg-transparent text-white">
      <EmptyHeader>
        <EmptyMedia variant="icon"><MusicIcon /></EmptyMedia>
        <EmptyTitle>{t(`${state}_title`)}</EmptyTitle>
        <EmptyDescription className="text-white/60">{t(`${state}_description`)}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/**
 * 播放器页（/music，见 docs/music-player-spec.md 第 5 节）：沉浸式全屏，与悬浮播放器共用全局播放状态。
 * 桌面端左栏为封面、信息与控制栏，右栏为歌词舞台；移动端在歌词视图（默认）与封面视图之间切换，控制栏固定在底部
 */
export function MusicPlayerPage() {
  const t = useTranslations('MusicPage')
  const router = useRouter()
  const { siteInfo } = useSiteInfo()
  const { playlist, currentTrack, isPlaying } = useMusic()
  // 移动端在歌词与封面两个视图之间切换，默认先看歌词
  const [view, setView] = useState<'cover' | 'lyrics'>('lyrics')
  const [playlistOpen, setPlaylistOpen] = useState(false)
  useMusicHotkeys()
  // 地址实时带上当前曲目与进度（?id=…&start=…），打开带参数的地址时定位到该曲目与进度
  useMusicShareUrl()

  const configured = siteInfo.musicSource === 'ncm' || Boolean(siteInfo.musicPlaylistUrl)
  // 歌单获取失败时全局播放器会以示例曲目（id 为 0）兜底
  const failed = playlist.length > 0 && playlist.every(track => track.id === 0)
  const placeholder = !configured ? 'not_configured' : failed ? 'failed' : !currentTrack ? 'loading' : null
  // 封面主色：作为歌词辉光与背景呼吸的默认颜色
  const accent = useCoverAccent(placeholder ? undefined : currentTrack?.albumPic)

  const goBack = () => {
    if (window.history.length > 1)
      router.back()
    else
      router.push('/')
  }

  return (
    <div className="dark fixed inset-0 flex flex-col overflow-hidden text-white" style={accent ? { ...PAGE_STYLE, '--lyric-accent': accent } as React.CSSProperties : PAGE_STYLE}>
      <VisitReporter />
      <MusicBackground cover={placeholder ? undefined : currentTrack?.albumPic} />
      {!placeholder && <MusicStageEffects />}

      <header className="relative z-10 flex items-center justify-between px-4 pt-4 lg:px-8 lg:pt-6">
        <button
          type="button"
          onClick={goBack}
          aria-label={t('back')}
          title={t('back')}
          className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
        >
          <ArrowLeftIcon aria-hidden className="size-5" />
        </button>
        {/* 移动端：封面视图与歌词视图切换 */}
        {!placeholder && (
          <button
            type="button"
            onClick={() => setView(view === 'cover' ? 'lyrics' : 'cover')}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none lg:hidden"
          >
            {view === 'cover' ? <MicVocalIcon aria-hidden className="size-4" /> : <Disc3Icon aria-hidden className="size-4" />}
            {t(view === 'cover' ? 'show_lyrics' : 'show_cover')}
          </button>
        )}
      </header>

      {placeholder || !currentTrack
        ? <PlayerPlaceholder state={placeholder ?? 'loading'} />
        : (
            <main
              className={cn(
                'relative z-10 mx-auto grid min-h-0 w-full max-w-7xl flex-1 gap-6 px-5 pt-4 pb-6',
                // 移动端：内容区（封面或歌词）+ 控制栏；桌面端：左栏封面与控制栏，右栏歌词
                'grid-rows-[minmax(0,1fr)_auto] [grid-template-areas:"main"_"controls"]',
                'lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-x-16 lg:px-12 lg:pt-2 lg:pb-12 lg:[grid-template-areas:"hero_stage"_"controls_stage"]',
              )}
            >
              <TrackHero
                track={currentTrack}
                playing={isPlaying}
                onCoverClick={() => setView('lyrics')}
                className={cn('[grid-area:main] lg:[grid-area:hero]', view === 'lyrics' && 'max-lg:hidden')}
              />
              <MusicLyricStage className={cn('min-h-0 [grid-area:main] lg:[grid-area:stage]', view === 'cover' && 'max-lg:hidden')} />
              {/* 与歌词舞台叠在同一网格区域，贴着底部：前奏导语与尾奏热评 */}
              <MusicLyricMoments className={cn('self-end pb-4 [grid-area:main] lg:[grid-area:stage] lg:pb-10', view === 'cover' && 'max-lg:hidden')} />
              <MusicPageControls className="[grid-area:controls]" onOpenPlaylist={() => setPlaylistOpen(true)} />
            </main>
          )}

      <MusicPlaylistSheet open={playlistOpen} onOpenChange={setPlaylistOpen} />
    </div>
  )
}
