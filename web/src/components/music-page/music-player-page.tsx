'use client'

import type { MusicTrack } from '@/models/music'
import { ArrowLeftIcon, BugIcon, Disc3Icon, FilmIcon, ImageIcon, MicVocalIcon, MusicIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { MarqueeText } from '@/components/common/marquee-text'
import { SafeImage } from '@/components/common/safe-image'
import { VisitReporter } from '@/components/common/visit-reporter'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/auth-context'
import { activateMusicRuntime, useMusicActions, useMusicLyrics, useMusicPlayback, useMusicPreferences } from '@/contexts/music-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useCachedSongMetaTranslation } from '@/contexts/song-meta-translations'
import { useRouter } from '@/i18n/navigation'
import { formatDisplayArtists, formatTitleAliases } from '@/lib/lyrics/song-meta-format'
import { cn } from '@/lib/utils'
import { formatMusicCoverUrl } from '@/utils/common/image'
import { isAdmin } from '@/utils/common/permission'
import { LyricAiRefreshMenu } from './lyric-ai-refresh-menu'
import { LyricOffsetControl } from './lyric-offset-control'
import { LyricSourceBadge } from './lyric-source-badge'
import { MusicBackground } from './music-background'
import { MusicLyricMoments } from './music-lyric-moments'
import { MusicLyricStage } from './music-lyric-stage'
import { MusicPageControls } from './music-page-controls'
import { MusicPlaylistSheet } from './music-playlist-sheet'
import { MusicStageEffects } from './music-stage-effects'
import { MvOffsetControl } from './mv-offset-control'
import { useSongAccent } from './use-cover-accent'
import { useMusicHotkeys } from './use-music-hotkeys'
import { useMusicShareUrl } from './use-music-share-url'
import { useMvSync } from './use-mv-sync'

// 韵律调试面板（含 KaTeX）只在打开时加载
const RhythmDebugPanel = dynamic(() => import('./rhythm-debug/rhythm-debug-panel'), { ssr: false })

// 播放器页固定为深色沉浸式界面：主色换成白色，进度条、焦点环等与白色文字协调
const PAGE_STYLE = { '--primary': 'oklch(0.97 0 0)', '--primary-foreground': 'oklch(0.2 0 0)' } as React.CSSProperties

/** 封面与曲目信息：暂停时封面略微缩小（与播放状态呼应） */
function TrackHero({ track, playing, onCoverClick, className }: { track: MusicTrack, playing: boolean, onCoverClick: () => void, className?: string }) {
  const t = useTranslations('MusicPage')
  const { user } = useAuth()
  const { getAudio } = useMusicActions()
  const { showTranslation } = useMusicPreferences()
  const { effectiveTranslationLang } = useMusicLyrics()
  const meta = useCachedSongMetaTranslation(track.id, effectiveTranslationLang)
  const titleExtra = formatTitleAliases(track.name, track.aliases, meta?.title, showTranslation, meta?.aliases)
  const displayArtists = formatDisplayArtists(track.artists, meta?.artists, showTranslation)
  // 歌词来源、重新生成 AI 歌词特效与整体偏移都是站长的工具：读者只看全站版本，不显示这些按钮
  const admin = !!user && isAdmin({ user })
  const mv = useMvSync({ trackId: track.id, getAudio, isAdmin: admin })
  return (
    <div className={cn('flex min-h-0 flex-col justify-center gap-6', className)}>
      <div
        onContextMenu={e => e.preventDefault()}
        // 正方形封面容器：拦截右键菜单，内部承载静态封面、静音同步 MV 与角落轻量控制按钮
        className="group relative mx-auto aspect-square w-[min(80vw,46dvh)] shrink-0 overflow-hidden rounded-2xl bg-white/10 shadow-2xl transition-transform duration-500 ease-out select-none lg:w-full lg:max-w-[26rem]"
        style={{ transform: playing ? 'scale(1)' : 'scale(0.92)' }}
      >
        {track.albumPic
          ? <SafeImage src={formatMusicCoverUrl(track.albumPic, 400)} alt={track.album} fill priority sizes="(min-width: 1024px) 416px, 72vw" className="pointer-events-none object-cover select-none" />
          : <MusicIcon aria-hidden className="pointer-events-none absolute inset-0 m-auto size-16 text-white/40" />}

        {/* 静音同步 MV 层：canplay 前或时间轴越界时透明隐藏，平滑显示底部静态专辑封面；object-contain 居中不裁剪画面 */}
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-black/85 transition-opacity duration-300 ease-out select-none',
            mv.videoVisible ? 'opacity-100' : 'opacity-0',
          )}
        >
          <video
            ref={mv.videoRef}
            src={mv.shouldLoadVideo ? mv.mvInfo?.streamUrl : undefined}
            controls={false}
            muted
            playsInline
            disablePictureInPicture
            disableRemotePlayback
            preload="auto"
            tabIndex={-1}
            aria-hidden="true"
            className="pointer-events-none size-full object-contain select-none"
          />
        </div>

        {/* 只有移动端可以点封面切换到歌词视图 */}
        <button
          type="button"
          aria-label={t('show_lyrics')}
          onClick={onCoverClick}
          className="absolute inset-0 z-10 lg:pointer-events-none"
        />

        {/* 角落操作栏：容器 pointer-events-none，仅各按钮本身启用 pointer-events-auto */}
        {mv.mvInfo?.available && (
          <div className="pointer-events-none absolute right-2.5 bottom-2.5 z-20 flex items-center gap-1.5">
            {!mv.disabled && (
              <button
                type="button"
                aria-label={t(mv.localMvEnabled ? 'mv_switch_to_cover' : 'mv_switch_to_video')}
                title={t(mv.localMvEnabled ? 'mv_switch_to_cover' : 'mv_switch_to_video')}
                aria-pressed={mv.localMvEnabled}
                onClick={(e) => {
                  e.stopPropagation()
                  mv.toggleLocalMv()
                }}
                className="pointer-events-auto inline-flex h-7 items-center gap-1 rounded-full bg-black/55 px-2.5 text-xs font-medium text-white/85 opacity-80 shadow-sm backdrop-blur-md transition-all group-hover:opacity-100 hover:bg-black/75 hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
              >
                {mv.localMvEnabled
                  ? <ImageIcon aria-hidden className="size-3.5" />
                  : <FilmIcon aria-hidden className="size-3.5" />}
                <span>{t(mv.localMvEnabled ? 'mv_mode_cover' : 'mv_mode_video')}</span>
              </button>
            )}
            {admin && (
              <MvOffsetControl
                offsetMs={mv.offsetMs}
                disabled={mv.disabled}
                saving={mv.saving}
                isDirty={mv.isDirty}
                onAdjustOffset={mv.adjustOffset}
                onDisabledChange={mv.setDisabledDraft}
                onSave={mv.saveSetting}
                className="opacity-85 group-hover:opacity-100 focus-visible:opacity-100"
              />
            )}
          </div>
        )}
      </div>
      <div className="grid min-w-0 gap-1 text-center lg:text-left">
        {/* 歌名与歌手过长时以跑马灯滚动（跑马灯内部是块级元素，标题用 role="heading" 而不是 h1）；key：切歌时从头滚动 */}
        <div role="heading" aria-level={1} className="min-w-0">
          <MarqueeText key={`name-${track.id}`} className="text-2xl font-bold text-white">
            {track.name}
            {titleExtra && <span className="ml-2 text-lg font-medium text-white/50">{`(${titleExtra})`}</span>}
          </MarqueeText>
        </div>
        <MarqueeText key={`artist-${track.id}`} className="text-base text-white/65">
          {[displayArtists.join(' / '), track.album].filter(Boolean).join(' · ')}
        </MarqueeText>
        {admin && (
          <div className="mt-1 flex max-w-full min-w-0 items-center gap-1.5 justify-self-center lg:justify-self-start">
            <LyricSourceBadge className="min-w-0 shrink" />
            <LyricOffsetControl className="shrink-0" />
            <LyricAiRefreshMenu className="shrink-0" />
          </div>
        )}
      </div>
    </div>
  )
}

/** 歌单未配置、加载中、加载失败或为空时的占位 */
function PlayerPlaceholder({
  state,
  seoHeading,
  seoDescription,
}: {
  state: 'not_configured' | 'loading' | 'failed' | 'empty'
  seoHeading?: string
  seoDescription?: string
}) {
  const t = useTranslations('MusicPage')
  return (
    <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-5">
      {seoHeading && (
        <div className="sr-only">
          <h1>{seoHeading}</h1>
          {seoDescription && <p>{seoDescription}</p>}
        </div>
      )}
      {state === 'loading'
        ? <Spinner className="m-auto size-8 text-white/70" aria-label={t('loading')} />
        : (
            <Empty className="m-auto border-0 bg-transparent text-white">
              <EmptyHeader>
                <EmptyMedia variant="icon"><MusicIcon /></EmptyMedia>
                <EmptyTitle>{t(`${state}_title`)}</EmptyTitle>
                <EmptyDescription className="text-white/60">{t(`${state}_description`)}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
    </main>
  )
}

/**
 * 播放器页（/music，见 docs/music-player-spec.md 第 5 节）：沉浸式全屏，与悬浮播放器共用全局播放状态。
 * 桌面端左栏为封面、信息与控制栏，右栏为歌词舞台；移动端在歌词视图（默认）与封面视图之间切换，控制栏固定在底部
 */
export function MusicPlayerPage({ seoHeading, seoDescription }: { seoHeading?: string, seoDescription?: string } = {}) {
  const t = useTranslations('MusicPage')
  const router = useRouter()
  const { siteInfo } = useSiteInfo()
  const { user } = useAuth()
  const { playlist, playlistState, currentTrack, isPlaying } = useMusicPlayback()
  const { ensurePlaylist } = useMusicActions()
  // 进入 /music 页时立即激活音乐运行时控制器与歌单恢复，并补全完整歌单（歌单抽屉、上一首 / 下一首、分享地址定位）
  useEffect(() => {
    if (siteInfo.musicEnabled)
      activateMusicRuntime({ syncPlaylist: true })
    void ensurePlaylist()
  }, [ensurePlaylist, siteInfo.musicEnabled])
  // 移动端在歌词与封面两个视图之间切换，默认先看歌词
  const [view, setView] = useState<'cover' | 'lyrics'>('lyrics')
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const debugT = useTranslations('RhythmDebug')
  useMusicHotkeys()
  // 地址实时带上当前曲目与进度（?id=…&start=…），打开带参数的地址时定位到该曲目与进度
  useMusicShareUrl()

  // 歌单只来自后台配置的网易云歌单（未配置时全局播放器不挂载，见 FloatingWidgets）
  const configured = Boolean(siteInfo.musicEnabled)
  const placeholder = !configured
    ? 'not_configured'
    : playlistState === 'failed'
      ? 'failed'
      : playlistState === 'loaded' && playlist.length === 0
        ? 'empty'
        : !currentTrack ? 'loading' : null
  // 韵律调试面板（节拍分析的波形、公式与参数）是调试工具，只对管理员显示，与歌词来源、偏移等站长工具一致
  const canDebug = !!user && isAdmin({ user })
  // 主题色（标注中模型选的颜色，没有时取封面主色）：作为歌词辉光与背景呼吸的默认颜色
  const accent = useSongAccent(placeholder ? undefined : currentTrack?.albumPic)

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

      <header className="relative z-20 flex items-center justify-between px-4 pt-4 lg:px-8 lg:pt-6">
        <button
          type="button"
          onClick={goBack}
          aria-label={t('back')}
          title={t('back')}
          className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
        >
          <ArrowLeftIcon aria-hidden className="size-5" />
        </button>
        {!placeholder && (
          <div className="flex items-center gap-2">
            {/* 移动端：封面视图与歌词视图切换 */}
            <button
              type="button"
              onClick={() => setView(view === 'cover' ? 'lyrics' : 'cover')}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none lg:hidden"
            >
              {view === 'cover' ? <MicVocalIcon aria-hidden className="size-4" /> : <Disc3Icon aria-hidden className="size-4" />}
              {t(view === 'cover' ? 'show_lyrics' : 'show_cover')}
            </button>
            {/* 韵律调试：节拍、动效的波形与公式（只对管理员显示） */}
            {canDebug && (
              <button
                type="button"
                onClick={() => setDebugOpen(open => !open)}
                aria-label={debugT('open')}
                aria-pressed={debugOpen}
                title={debugT('open')}
                className={cn(
                  'inline-flex size-10 items-center justify-center rounded-full text-white backdrop-blur transition-colors focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none',
                  debugOpen ? 'bg-white/25' : 'bg-white/10 hover:bg-white/20',
                )}
              >
                <BugIcon aria-hidden className="size-5" />
              </button>
            )}
          </div>
        )}
      </header>
      {debugOpen && canDebug && !placeholder && <RhythmDebugPanel onClose={() => setDebugOpen(false)} />}

      {placeholder || !currentTrack
        ? <PlayerPlaceholder state={placeholder ?? 'loading'} seoHeading={seoHeading} seoDescription={seoDescription} />
        : (
            <main
              className={cn(
                'relative mx-auto grid min-h-0 w-full max-w-7xl flex-1 gap-6 px-5 pt-4 pb-6',
                // 移动端：内容区（封面或歌词）+ 控制栏；桌面端：左栏封面与控制栏，右栏歌词
                'grid-rows-[minmax(0,1fr)_auto] [grid-template-areas:"main"_"controls"]',
                'lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-x-16 lg:px-12 lg:pt-2 lg:pb-12 lg:[grid-template-areas:"hero_stage"_"controls_stage"]',
              )}
            >
              <TrackHero
                track={currentTrack}
                playing={isPlaying}
                onCoverClick={() => setView('lyrics')}
                className={cn('relative z-10 [grid-area:main] lg:[grid-area:hero]', view === 'lyrics' && 'max-lg:hidden')}
              />
              {/* 副歌开唱时随镜头推近略微放大（见 MusicStageEffects）；歌词与控件位于 z-20，粒子画布（z-[15]）穿行于封面/MV（z-10）之上、文字之下 */}
              <MusicLyricStage stagePush={0.04} className={cn('relative z-20 min-h-0 [grid-area:main] lg:[grid-area:stage]', view === 'cover' && 'max-lg:hidden')} />
              {/* 与歌词舞台叠在同一网格区域，贴着底部：前奏导语与尾奏热评 */}
              <MusicLyricMoments className={cn('relative z-20 self-end pb-4 [grid-area:main] lg:[grid-area:stage] lg:pb-10', view === 'cover' && 'max-lg:hidden')} />
              <MusicPageControls className="relative z-20 [grid-area:controls]" onOpenPlaylist={() => setPlaylistOpen(true)} />
            </main>
          )}

      <MusicPlaylistSheet open={playlistOpen} onOpenChange={setPlaylistOpen} />
    </div>
  )
}
