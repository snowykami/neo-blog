'use client'

import type { IslandActivity } from '@/contexts/topbar-island'
import type { MusicTrack } from '@/models/music'
import type { IslandSettings } from '@/utils/common/siteinfo'
import { Maximize2Icon, PlayIcon } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MarqueeText } from '@/components/common/marquee-text'
import { MusicMiniPlaylist } from '@/components/common/music-mini-playlist'
import { AlbumNavIcon } from '@/components/common/music-player'
import { SafeImage } from '@/components/common/safe-image'
import { MusicBackground } from '@/components/music-page/music-background'
import { MusicLyricStage } from '@/components/music-page/music-lyric-stage'
import { MusicPageControls } from '@/components/music-page/music-page-controls'
import { MusicStageEffects } from '@/components/music-page/music-stage-effects'
import { useSongAccent } from '@/components/music-page/use-cover-accent'
import { useCurrentLyric, useMusic, useMusicClockStore } from '@/contexts/music-context'
import { useSongChorus } from '@/contexts/song-chorus'
import { pushIslandAlert, useIslandActivity } from '@/contexts/topbar-island'
import { lyricMomentAt } from '@/lib/lyrics/moments'
import { backgroundLevel, rhythmContext } from '@/lib/lyrics/rhythm/effects'
import { rhythmModelFor } from '@/lib/lyrics/rhythm/source'

// 优先级：播放中高于文章阅读进度（读者主动开启的音乐更有个性），暂停后低于一切
const PLAYING_PRIORITY = 50
const PAUSED_PRIORITY = 10
// 切歌提示的停留时长
const PEEK_MS = 3200
// 与悬浮播放器一致：主色换成白色，进度条、焦点环等与深色面板协调
const PANEL_STYLE = { '--primary': 'oklch(0.97 0 0)', '--primary-foreground': 'oklch(0.2 0 0)' } as React.CSSProperties

// 不需要订阅播放进度时的占位
const noopSubscribe = () => () => {}
const falseSnapshot = () => false
const nullSnapshot = () => null

function trackTitle(track: MusicTrack) {
  return [track.name, track.artists.join(' / ')].filter(Boolean).join(' - ')
}

/**
 * 音乐活动：播放时胶囊里是模糊封面底 + 旋转封面 + 歌词引擎的单行条（逐字擦除、强调特效、间奏圆点、副歌爆发都与播放器一致），
 * 右侧律动条跟随节拍；副歌段胶囊描边泛起封面主色；前奏与尾奏显示导语和热评；切歌时短暂显示歌名；
 * 暂停后（本页播放过时）缩成封面 + 播放键，点按继续；点按展开迷你播放器。播放器页本身就是完整播放器，不显示
 */
export function MusicIsland({ settings }: { settings: IslandSettings }) {
  const t = useTranslations('TopbarIsland')
  const { currentTrack, isPlaying, play } = useMusic()
  const onPlayerPage = usePathname() === '/music'
  // 本页播放过才在暂停后保留：刚打开页面时歌单已恢复到上次的曲目，但读者还没听，不应常驻
  const [hasPlayed, setHasPlayed] = useState(false)
  if (isPlaying && !hasPlayed)
    setHasPlayed(true)
  const accent = useSongAccent(currentTrack?.albumPic)
  const inChorus = useInChorus(isPlaying && settings.musicChorus ? currentTrack?.id ?? null : null)
  const title = currentTrack ? trackTitle(currentTrack) : ''

  const activity = useMemo<IslandActivity | null>(() => {
    if (!currentTrack || onPlayerPage)
      return null
    if (isPlaying) {
      return {
        id: 'music',
        feature: 'music',
        priority: PLAYING_PRIORITY,
        label: t('music_playing', { title }),
        compact: <MusicCompact beat={settings.musicBeat} moments={settings.musicMoments} />,
        minimal: <AlbumNavIcon />,
        panel: <MusicPanel />,
        glow: inChorus ? (accent ?? 'rgb(255 255 255)') : null,
      }
    }
    if (!hasPlayed)
      return null
    return {
      id: 'music',
      feature: 'musicPaused',
      priority: PAUSED_PRIORITY,
      label: t('music_paused', { title }),
      compact: (
        <>
          <AlbumNavIcon />
          <PlayIcon aria-hidden className="size-3.5 fill-current" />
        </>
      ),
      minimal: <AlbumNavIcon />,
      onPress: play,
    }
  }, [accent, currentTrack, hasPlayed, inChorus, isPlaying, onPlayerPage, play, settings.musicBeat, settings.musicMoments, t, title])
  useIslandActivity(activity)

  // 开始播放或切歌时短暂显示歌名（同一首只提示一次）
  const peekedRef = useRef<number | null>(null)
  useEffect(() => {
    if (!isPlaying || !currentTrack || onPlayerPage || peekedRef.current === currentTrack.id)
      return
    peekedRef.current = currentTrack.id
    pushIslandAlert({
      key: 'music-track',
      feature: 'musicPeek',
      icon: currentTrack.albumPic
        ? <SafeImage src={currentTrack.albumPic} alt="" width={20} height={20} sizes="20px" fallback={null} className="size-5 rounded-md object-cover" />
        : undefined,
      text: trackTitle(currentTrack),
      announce: t('music_now_playing', { title: trackTitle(currentTrack) }),
      duration: PEEK_MS,
    })
  }, [currentTrack, isPlaying, onPlayerPage, t])

  return null
}

/** 是否正在副歌段（网易云标出的高潮片段）；id 为空时不订阅播放进度 */
function useInChorus(id: number | null) {
  const chorus = useSongChorus(id)
  const clock = useMusicClockStore()
  const getSnapshot = useCallback(() => {
    const ms = clock.getSnapshot() * 1000
    return chorus.some(item => ms >= item.start && ms < item.end)
  }, [chorus, clock])
  return useSyncExternalStore(id == null ? noopSubscribe : clock.subscribe, id == null ? falseSnapshot : getSnapshot, falseSnapshot)
}

/** 胶囊里的播放内容：背景铺满整个胶囊（定位祖先为胶囊内容层） */
function MusicCompact({ beat, moments }: { beat: boolean, moments: boolean }) {
  const { currentTrack, lyricLines, lyrics } = useMusic()
  const accent = useSongAccent(currentTrack?.albumPic)
  const moment = useIntroOutro(moments)
  const hasLyric = lyricLines.length > 0 || lyrics.instrumental
  // 随拍染色层：律动条逐帧写入不透明度
  const tintRef = useRef<HTMLSpanElement>(null)
  return (
    <span className="contents" style={accent ? { '--lyric-accent': accent } as React.CSSProperties : undefined}>
      {/* 标题区域只有一行高，按播放器的模糊半径会糊成一片黑，改用小半径保留封面的颜色 */}
      <MusicBackground cover={currentTrack?.albumPic} contained imageClassName="blur-md" />
      <MusicStageEffects contained />
      {beat && <span ref={tintRef} aria-hidden className="pointer-events-none absolute inset-0 bg-[color:var(--lyric-accent,#fff)] opacity-0" />}
      <span className="relative flex shrink-0 items-center"><AlbumNavIcon /></span>
      <span className="relative flex h-9 w-[36ch] max-w-full min-w-0 shrink items-center">
        {moment
          ? <MarqueeText className={moment.italic ? 'italic' : undefined}>{moment.text}</MarqueeText>
          : hasLyric
            ? <MusicLyricStage strip className="-mx-2.5 h-full w-full" />
            : <MarqueeText>{currentTrack ? trackTitle(currentTrack) : ''}</MarqueeText>}
      </span>
      {beat && <BeatBars tintRef={tintRef} />}
    </span>
  )
}

/** 前奏导语与尾奏热评（歌词标注的「时刻」）；关键节点的旁白与歌词同时出现，单行放不下，不在胶囊里显示 */
function useIntroOutro(enabled: boolean): { text: string, italic: boolean } | null {
  const { lyrics, duration, showLyricMoments } = useMusic()
  const clock = useMusicClockStore()
  const active = enabled && showLyricMoments && !!(lyrics.intro || lyrics.outro)
  const getMoment = useCallback(() => {
    const moment = lyricMomentAt(lyrics, clock.getSnapshot() * 1000, duration == null ? null : duration * 1000)
    return moment === 'intro' || moment === 'outro' ? moment : null
  }, [clock, duration, lyrics])
  const moment = useSyncExternalStore(active ? clock.subscribe : noopSubscribe, active ? getMoment : nullSnapshot, nullSnapshot)
  if (moment === 'intro' && lyrics.intro)
    return { text: lyrics.intro, italic: true }
  if (moment === 'outro' && lyrics.outro)
    return { text: `“${lyrics.outro.content}”`, italic: false }
  return null
}

// 律动条的相对高度与相位：三根错开一点，避免整齐划一
const BARS = [{ weight: 0.75, lagMs: 60, freq: 7.1 }, { weight: 1, lagMs: 0, freq: 9.3 }, { weight: 0.85, lagMs: 120, freq: 5.7 }]
// 跟随节拍时胶囊底色泛起封面主色的最大不透明度
const BEAT_TINT_OPACITY = 0.22

/**
 * 胶囊右侧的律动条：有可信的节拍模型时随拍跳动、随拍变亮，胶囊底色也随拍泛起封面主色（只变颜色，胶囊大小不随拍变化，避免整颗岛一抽一抽）；
 * 没有时（移动端不分析节拍、分析失败等）以错开的起伏模拟，不染色。逐帧直接写 DOM，不触发 React 渲染；暂停或减少动态效果时静止
 */
function BeatBars({ tintRef }: { tintRef: React.RefObject<HTMLSpanElement | null> }) {
  const { getAudio, isPlaying, lyrics, currentTrack } = useMusic()
  const reducedMotion = useReducedMotion()
  const rootRef = useRef<HTMLSpanElement>(null)
  const stateRef = useRef({ pace: lyrics.pace, trackId: currentTrack?.id ?? null })
  useEffect(() => {
    stateRef.current = { pace: lyrics.pace, trackId: currentTrack?.id ?? null }
  }, [currentTrack?.id, lyrics.pace])

  useEffect(() => {
    const root = rootRef.current
    if (!root || !isPlaying || reducedMotion)
      return
    const bars = Array.from(root.children) as HTMLElement[]
    const tint = tintRef.current
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const audio = getAudio()
      if (!audio)
        return
      const timeMs = audio.currentTime * 1000
      const ctx = rhythmContext(stateRef.current.pace, rhythmModelFor(stateRef.current.trackId))
      bars.forEach((bar, i) => {
        const { weight, lagMs, freq } = BARS[i]
        const level = ctx.model
          ? backgroundLevel(ctx, timeMs - lagMs)
          : 0.5 + 0.5 * Math.sin(timeMs / 1000 * freq + i)
        bar.style.transform = `scaleY(${(0.3 + 0.7 * weight * level).toFixed(3)})`
        bar.style.opacity = ctx.model ? (0.55 + 0.45 * level).toFixed(3) : ''
      })
      if (tint)
        tint.style.opacity = ctx.model ? (BEAT_TINT_OPACITY * backgroundLevel(ctx, timeMs)).toFixed(3) : ''
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      if (tint)
        tint.style.opacity = ''
    }
  }, [getAudio, isPlaying, reducedMotion, tintRef])

  return (
    <span ref={rootRef} aria-hidden className="relative flex h-4 shrink-0 items-center gap-[3px]">
      {BARS.map(bar => (
        <span key={bar.freq} className="block h-full w-[3px] origin-center scale-y-50 rounded-full bg-[color:var(--lyric-accent,#fff)]" />
      ))}
    </span>
  )
}

/** 展开面板：迷你播放器（封面、歌名、当前歌词、进度与控制），可跳到播放器页 */
function MusicPanel() {
  const t = useTranslations('TopbarIsland')
  const { currentTrack } = useMusic()
  const lyric = useCurrentLyric()
  if (!currentTrack)
    return null
  return (
    <div className="grid gap-3" style={PANEL_STYLE}>
      <div className="flex items-center gap-3">
        <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-white/10">
          {currentTrack.albumPic && <SafeImage src={currentTrack.albumPic} alt="" fill sizes="56px" fallback={null} className="object-cover" />}
        </div>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <MarqueeText className="font-semibold">{currentTrack.name}</MarqueeText>
          <p className="truncate text-sm text-white/60">{currentTrack.artists.join(' / ')}</p>
        </div>
        <Link
          href="/music"
          aria-label={t('music_open_player')}
          title={t('music_open_player')}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
        >
          <Maximize2Icon aria-hidden className="size-4" />
        </Link>
      </div>
      {lyric && <p className="line-clamp-2 text-sm text-white/80">{lyric}</p>}
      <MusicPageControls compact playlistSlot={<MusicMiniPlaylist />} />
    </div>
  )
}
