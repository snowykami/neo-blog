'use client'

import { Maximize2Icon, MusicIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import React, { useEffect } from 'react'
import { SafeImage } from '@/components/common/safe-image'
import { useIslandPanelPhase } from '@/components/layout/topbar-island/island-panel-phase'
import { MusicBackground } from '@/components/music-page/music-background'
import { MusicLyricMoments } from '@/components/music-page/music-lyric-moments'
import { MUSIC_ICON_BUTTON_CLASSNAME, MusicPageControls } from '@/components/music-page/music-page-controls'
import { MusicStageEffects } from '@/components/music-page/music-stage-effects'
import { useSongAccent } from '@/components/music-page/use-cover-accent'
import { useCurrentLyric, useMusicActions, useMusicPlayback, useMusicPreferences } from '@/contexts/music-context'
import { useCachedSongMetaTranslation } from '@/contexts/song-meta-translations'
import { Link } from '@/i18n/navigation'
import { formatDisplayArtists, formatTitleAliases } from '@/lib/lyrics/song-meta-format'
import { cn } from '@/lib/utils'
import { formatMusicCoverUrl } from '@/utils/common/image'
import { MarqueeText } from './marquee-text'
import { MusicMiniPlaylist } from './music-mini-playlist'
import { useMiniPlayerHold } from './music-player-shared'

// 歌词引擎（含歌词字体样式表）比播放器本身重得多，等轻量外壳渲染出来再加载
const MusicLyricStage = dynamic(() => import('@/components/music-page/music-lyric-stage').then(m => m.MusicLyricStage), { ssr: false })

/**
 * 歌词引擎挂载前的替身：不显示，只标出当前这一句在紧凑模式里的大致落点（字号同焦点行，对齐在歌词区 40% 的高度）。
 * 从顶栏灵动岛展开时，胶囊里带样式的单行歌词按它的位置与字号飞过来，留在这里；歌词引擎挂上来换下替身后，
 * 滑到引擎里同一句（.lyric-main）的位置再淡出（焦点行带音译、翻译时比替身靠上，见 topbar-island/island-morph.ts）
 */
function LyricLineStandIn() {
  const text = useCurrentLyric()
  return (
    <div aria-hidden data-island-morph="lyrics" data-island-morph-standin=".lyric-main" className="invisible absolute inset-x-0 top-[40%] -translate-y-1/2 truncate px-2 text-[1.0625rem] leading-[1.35] font-bold">
      {text}
    </div>
  )
}

/**
 * 悬浮播放器：播放器页（/music）的缩小版，共用歌词引擎（紧凑模式）、歌词来源标签、控制栏与全部特效（全屏特效为小窗精简版）；
 * 歌单为从歌单按钮弹出的小浮层，歌名与歌手过长时以跑马灯滚动；右上角的按钮进入完整的播放器页（onOpenPage 用于同时收起弹层）。
 * 悬浮球与顶栏灵动岛的弹层共用，单独拆出以按需加载，避免未展开时把特效与控制栏打包进悬浮球首屏 chunk
 */
export function MiniPlayer({ onOpenPage }: { onOpenPage?: () => void }) {
  const t = useTranslations('MusicPlayer')
  const { currentTrack, isPlaying } = useMusicPlayback()
  const { showTranslation } = useMusicPreferences()
  const meta = useCachedSongMetaTranslation(currentTrack?.id ?? null)
  const { ensurePlaylist } = useMusicActions()
  // 打开悬浮播放器时补全歌单（恢复播放时可能只取了一首），歌单浮层与上一首 / 下一首都要用
  useEffect(() => {
    void ensurePlaylist()
  }, [ensurePlaylist])
  // 在顶栏灵动岛的面板里时所处的阶段（悬浮球的弹层里为 null）：形变期间歌词区先放当前这一句的替身（落点），
  // 展开完再挂载歌词引擎（排上千个字的开销不卡住展开动画）；开始收起后歌词引擎停在此刻（前景随即淡出），交还给胶囊
  const panelPhase = useIslandPanelPhase()
  const panelReady = panelPhase !== 'opening'
  const lyricsRunning = panelPhase == null || panelPhase === 'open'
  useMiniPlayerHold('floating', panelPhase == null)
  useMiniPlayerHold('effects', true)
  useMiniPlayerHold('lyrics', lyricsRunning)
  // 与播放器页相同：主题色（模型选的颜色或封面主色）作为辉光与呼吸的默认颜色
  const accent = useSongAccent(currentTrack?.albumPic)
  if (!currentTrack)
    return null

  const titleExtra = formatTitleAliases(currentTrack.name, currentTrack.aliases, meta?.title, showTranslation, meta?.aliases)
  const displayArtists = formatDisplayArtists(currentTrack.artists, meta?.artists, showTranslation)

  return (
    <div role="region" aria-label={t('floating_player')} className="relative isolate" style={accent ? { '--lyric-accent': accent } as React.CSSProperties : undefined}>
      <MusicBackground cover={currentTrack.albumPic} contained morphBackdrop />
      {/* 全屏特效的小窗版：背景呼吸、副歌爆发、染色、节拍呼吸、粒子场景（粒子缩小、数量减少） */}
      <MusicStageEffects contained />
      {/* data-island-morph-fade：从顶栏灵动岛展开 / 收起时只有前景淡入淡出，模糊封面背景与全屏特效全程显示、随形状伸缩（见 topbar-island/island-morph.ts） */}
      <div data-island-morph-fade className="relative grid gap-3 p-4">
        <div className="flex items-center gap-3">
          {/* 暂停时封面略微缩小，与播放器页一致 */}
          {/* data-island-morph：从顶栏灵动岛展开时封面从胶囊里的小封面放大到这里，歌词区同理（见 topbar-island/island-morph.ts） */}
          <span
            data-island-morph="cover"
            className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-white/10 shadow-lg transition-transform duration-500 ease-out"
            style={{ transform: isPlaying ? 'scale(1)' : 'scale(0.92)' }}
          >
            {currentTrack.albumPic
              ? <SafeImage src={formatMusicCoverUrl(currentTrack.albumPic, 120)} alt={currentTrack.album} fill sizes="56px" quality={45} className="object-cover" />
              : <MusicIcon aria-hidden className="absolute inset-0 m-auto size-6 text-white/40" />}
          </span>
          <div className="grid min-w-0 flex-1 content-center gap-1">
            {/* key：切歌时重新测量并从头滚动 */}
            <MarqueeText key={`name-${currentTrack.id}`} className="text-base leading-snug font-semibold">
              {currentTrack.name}
              {titleExtra && <span className="ml-1 font-normal text-white/50">{`(${titleExtra})`}</span>}
            </MarqueeText>
            <MarqueeText key={`artist-${currentTrack.id}`} className="text-sm leading-snug text-white/60">
              {[displayArtists.join(' / '), currentTrack.album].filter(Boolean).join(' · ')}
            </MarqueeText>
          </div>
          <Link
            href="/music"
            onClick={onOpenPage}
            aria-label={t('open_player_page')}
            title={t('open_player_page')}
            className={cn(MUSIC_ICON_BUTTON_CLASSNAME, '-mt-1 -mr-1 self-start')}
          >
            <Maximize2Icon aria-hidden className="size-4" />
          </Link>
        </div>
        {/* 展开时歌词区不跟着平移（胶囊里的歌词飞到替身那里）；挂上歌词引擎后收起时整块平移回胶囊里的歌词处 */}
        <div data-island-morph={panelReady ? 'lyrics' : undefined} className="relative h-44">
          {panelReady
            ? (
                <>
                  <MusicLyricStage compact paused={!lyricsRunning} className="h-full animate-in duration-200 fade-in-0" />
                  <MusicLyricMoments compact className="absolute inset-x-0 bottom-1" />
                </>
              )
            : <LyricLineStandIn />}
        </div>
        <MusicPageControls compact playlistSlot={<MusicMiniPlaylist />} />
      </div>
    </div>
  )
}
