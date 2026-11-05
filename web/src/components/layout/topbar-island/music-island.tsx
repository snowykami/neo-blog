'use client'

import type { IslandActivity } from '@/contexts/topbar-island'
import type { MusicTrack } from '@/models/music'
import type { IslandSettings } from '@/utils/common/siteinfo'
import { PlayIcon } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MarqueeText } from '@/components/common/marquee-text'
import { AlbumNavIcon, MINI_PLAYER_POPOVER_CLASSNAME, MINI_PLAYER_POPOVER_STYLE, MiniPlayer } from '@/components/common/music-player'
import { SafeImage } from '@/components/common/safe-image'
import { MusicBackground } from '@/components/music-page/music-background'
import { MusicLyricStage } from '@/components/music-page/music-lyric-stage'
import { MusicStageEffects } from '@/components/music-page/music-stage-effects'
import { useSongAccent } from '@/components/music-page/use-cover-accent'
import { useMusic, useMusicClockStore } from '@/contexts/music-context'
import { useSongChorus } from '@/contexts/song-chorus'
import { dismissIslandAlert, pushIslandAlert, useIslandActivity } from '@/contexts/topbar-island'
import { backgroundLevel, rhythmContext } from '@/lib/lyrics/rhythm/effects'
import { rhythmModelFor } from '@/lib/lyrics/rhythm/source'
import { IslandSlot, IslandText } from './island-parts'

// 优先级：播放中高于文章阅读进度（读者主动开启的音乐更有个性），暂停后低于一切
const PLAYING_PRIORITY = 50
const PAUSED_PRIORITY = 10
// 切歌提示最多停留这么久；歌词一开唱就立即让位给歌词
const PEEK_MS = 1500
const PEEK_KEY = 'music-track'
// 切歌加载新曲目时会短暂暂停：暂停持续这么久才换成暂停态，避免胶囊闪一下
const PAUSE_SETTLE_MS = 350

// 不需要订阅播放进度时的占位
const noopSubscribe = () => () => {}
const falseSnapshot = () => false

function trackTitle(track: MusicTrack) {
  return [track.name, track.artists.join(' / ')].filter(Boolean).join(' - ')
}

/**
 * 音乐活动：播放时胶囊里是模糊封面底 + 旋转封面 + 歌词引擎的单行条（逐字擦除、强调特效、间奏圆点、副歌爆发都与播放器一致），
 * 右侧律动条跟随节拍；副歌段胶囊描边泛起封面主色；切歌时短暂显示歌名（不显示导语、热评等句子，岛上只放歌词）；
 * 暂停后（本页播放过时）缩成封面 + 播放键，点按继续；点按展开与悬浮球相同的播放器弹层（从胶囊下方弹出）。播放器页本身就是完整播放器，不显示
 */
export function MusicIsland({ settings }: { settings: IslandSettings }) {
  const t = useTranslations('TopbarIsland')
  const { currentTrack, isPlaying, play } = useMusic()
  const onPlayerPage = usePathname() === '/music'
  // 本页播放过才在暂停后保留：刚打开页面时歌单已恢复到上次的曲目，但读者还没听，不应常驻
  const [hasPlayed, setHasPlayed] = useState(false)
  if (isPlaying && !hasPlayed)
    setHasPlayed(true)
  const [pauseSettled, setPauseSettled] = useState(false)
  useEffect(() => {
    if (isPlaying) {
      setPauseSettled(false)
      return
    }
    const timer = window.setTimeout(setPauseSettled, PAUSE_SETTLE_MS, true)
    return () => window.clearTimeout(timer)
  }, [isPlaying])
  // 刚暂停的一小段时间内仍按播放中显示
  const showPlaying = isPlaying || (hasPlayed && !pauseSettled)
  const accent = useSongAccent(currentTrack?.albumPic)
  const inChorus = useInChorus(isPlaying && settings.musicChorus ? currentTrack?.id ?? null : null)
  const lyricStarted = useLyricStarted(isPlaying)
  const title = currentTrack ? trackTitle(currentTrack) : ''

  const activity = useMemo<IslandActivity | null>(() => {
    if (!currentTrack || onPlayerPage)
      return null
    if (showPlaying) {
      return {
        id: 'music',
        feature: 'music',
        priority: PLAYING_PRIORITY,
        label: t('music_playing', { title }),
        compact: <MusicCompact beat={settings.musicBeat} />,
        minimal: <AlbumNavIcon />,
        panel: <MiniPlayer />,
        panelClassName: MINI_PLAYER_POPOVER_CLASSNAME,
        panelStyle: MINI_PLAYER_POPOVER_STYLE,
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
          <IslandSlot><AlbumNavIcon /></IslandSlot>
          <IslandSlot className="[&>svg]:size-3.5"><PlayIcon aria-hidden className="fill-current" /></IslandSlot>
        </>
      ),
      minimal: <AlbumNavIcon />,
      onPress: play,
    }
  }, [accent, currentTrack, hasPlayed, inChorus, onPlayerPage, play, settings.musicBeat, showPlaying, t, title])
  useIslandActivity(activity)

  // 开始播放或切歌时短暂显示歌名（同一首只提示一次）；歌词已经在唱（如从中段继续播放）时不提示，直接显示歌词
  const peekedRef = useRef<number | null>(null)
  useEffect(() => {
    if (!isPlaying || !currentTrack || onPlayerPage || peekedRef.current === currentTrack.id)
      return
    peekedRef.current = currentTrack.id
    if (lyricStarted)
      return
    pushIslandAlert({
      key: PEEK_KEY,
      feature: 'musicPeek',
      icon: currentTrack.albumPic
        ? <SafeImage src={currentTrack.albumPic} alt="" width={24} height={24} sizes="24px" fallback={null} className="size-6 rounded-md object-cover" />
        : undefined,
      text: trackTitle(currentTrack),
      announce: t('music_now_playing', { title: trackTitle(currentTrack) }),
      duration: PEEK_MS,
    })
    // lyricStarted 不放进依赖：只在切歌、开始播放时判断一次，歌词开唱后由下面的 effect 撤下提示
  }, [currentTrack, isPlaying, onPlayerPage, t])

  // 歌词一开唱就撤下切歌提示
  useEffect(() => {
    if (lyricStarted)
      dismissIslandAlert(PEEK_KEY)
  }, [currentTrack?.id, lyricStarted])

  return null
}

/** 第一句歌词是否已经开唱（前奏期间为 false）；enabled 为 false 时不订阅播放进度 */
function useLyricStarted(enabled: boolean) {
  const { lyricLines } = useMusic()
  const clock = useMusicClockStore()
  const getSnapshot = useCallback(
    () => lyricLines.length > 0 && clock.getSnapshot() * 1000 >= lyricLines[0].startTime,
    [clock, lyricLines],
  )
  return useSyncExternalStore(enabled ? clock.subscribe : noopSubscribe, enabled ? getSnapshot : falseSnapshot, falseSnapshot)
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
function MusicCompact({ beat }: { beat: boolean }) {
  const { currentTrack, lyricLines, lyrics } = useMusic()
  const accent = useSongAccent(currentTrack?.albumPic)
  const hasLyric = lyricLines.length > 0 || lyrics.instrumental
  // 随拍染色层：律动条逐帧写入不透明度
  const tintRef = useRef<HTMLSpanElement>(null)
  return (
    <span className="contents" style={accent ? { '--lyric-accent': accent } as React.CSSProperties : undefined}>
      {/* 标题区域只有一行高，按播放器的模糊半径会糊成一片黑，改用小半径保留封面的颜色 */}
      <MusicBackground cover={currentTrack?.albumPic} contained imageClassName="blur-md" />
      <MusicStageEffects contained />
      {beat && <span ref={tintRef} aria-hidden className="pointer-events-none absolute inset-0 bg-[color:var(--lyric-accent,#fff)] opacity-0" />}
      <IslandSlot><AlbumNavIcon /></IslandSlot>
      {/* 歌词与文字离封面、律动条各 10px：单行条自带 10px 内边距，左右各收回 6px */}
      <span className="relative flex h-9 w-[36ch] max-w-full min-w-0 shrink items-center">
        {hasLyric
          ? <MusicLyricStage strip className="-mx-1.5 h-full min-w-0 flex-1" />
          : <IslandText className="flex-1"><MarqueeText>{currentTrack ? trackTitle(currentTrack) : ''}</MarqueeText></IslandText>}
      </span>
      {beat && <IslandSlot><BeatBars tintRef={tintRef} /></IslandSlot>}
    </span>
  )
}

// 律动条：5 根 2px 细条（同 Apple 音乐的波形，中间最高），相对高度与相位错开一点，避免整齐划一
const BARS = [
  { weight: 0.6, lagMs: 90, freq: 6.3 },
  { weight: 0.85, lagMs: 40, freq: 8.1 },
  { weight: 1, lagMs: 0, freq: 9.7 },
  { weight: 0.8, lagMs: 60, freq: 7.4 },
  { weight: 0.65, lagMs: 120, freq: 5.2 },
]
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
    <span ref={rootRef} aria-hidden className="flex h-4 items-center gap-[2px]">
      {BARS.map(bar => (
        <span key={bar.freq} className="block h-full w-[2px] origin-center scale-y-50 rounded-full bg-[color:var(--lyric-accent,#fff)]" />
      ))}
    </span>
  )
}
