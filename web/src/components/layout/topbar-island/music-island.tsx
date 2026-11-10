'use client'

import type { IslandActivity, IslandGlow } from '@/contexts/topbar-island'
import type { MusicTrack } from '@/models/music'
import type { IslandSettings } from '@/utils/common/siteinfo'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AlbumNavIcon, MINI_PLAYER_POPOVER_CLASSNAME, MINI_PLAYER_POPOVER_STYLE, useMiniPlayerHolding } from '@/components/common/music-player-shared'
import { useCoverAccent } from '@/components/music-page/use-cover-accent'
import { useMusic, useMusicClockStore } from '@/contexts/music-context'
import { useSongChorus } from '@/contexts/song-chorus'
import { dismissIslandAlert, pushIslandAlert, useIslandActivity } from '@/contexts/topbar-island'
import { lyricGlowAt } from '@/lib/lyrics/lyric-glow'
import { buildTimeline, getLineTextAt } from '@/lib/lyrics/timeline'

// 胶囊内容（舞台特效、粒子、HDR、节拍模型、歌词引擎）与展开后的播放器都很重，而灵动岛每页都挂着：
// 静态引用会把它们全部拉进每一页的首屏 JS。所以有曲目（播放器已在空闲时挂上、歌单就绪）后才加载，
// 加载完之前不出音乐活动。播放器本体也在同一个 chunk 里，这时通常已经下载过，几乎是立即就绪
const loadCompact = () => import('./music-island-compact')
const loadPlayer = () => import('@/components/common/music-player')

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
const emptySnapshot = () => ''

function trackTitle(track: MusicTrack) {
  return [track.name, track.artists.join(' / ')].filter(Boolean).join(' - ')
}

/**
 * 音乐活动：播放时胶囊里是模糊封面底 + 旋转封面 + 歌词引擎的单行条（逐字擦除、强调特效、间奏圆点、副歌爆发都与播放器一致），
 * 右侧律动条跟随节拍；副歌段胶囊描边发光，颜色随此刻在唱的歌词（强调短语的颜色、这一行情绪的辉光色），没有时取封面主色，唱到强调或点题句时辉光范围更大；切歌时短暂显示封面与歌名（不显示导语、热评等句子，岛上只放歌词）；
 * 暂停后（本页播放过时）变成封面 + 暂停那一刻的那句歌词（静态文字，间奏、开唱前或没有歌词时为歌名）+ 播放键，宽度收到正好放下文字（不超过播放时的宽度），点按继续；
 * 点按展开与悬浮球相同的播放器弹层（从胶囊下方弹出）。播放器页本身就是完整播放器，不显示；
 * 悬浮球的弹层开着时同样不显示（待命，岛收起成没有音乐时的样子），关上后再出现
 */
export function MusicIsland({ settings }: { settings: IslandSettings }) {
  const t = useTranslations('TopbarIsland')
  const { currentTrack, isPlaying, play } = useMusic()
  const onPlayerPage = usePathname() === '/music'
  // 悬浮球的弹层开着：歌词与特效都在弹层里，岛上不再重复显示
  const floatingOpen = useMiniPlayerHolding('floating')
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
  const coverAccent = useCoverAccent(currentTrack?.albumPic)
  const inChorus = useInChorus(isPlaying && settings.musicChorus && !floatingOpen ? currentTrack?.id ?? null : null)
  const glow = useLyricGlow(inChorus, coverAccent)
  const lyricStarted = useLyricStarted(isPlaying)
  const pausedLine = usePausedLine(!showPlaying && hasPlayed)
  const title = currentTrack ? trackTitle(currentTrack) : ''
  const wanted = Boolean(currentTrack) && !onPlayerPage
  const compactModule = useLazyModule(loadCompact, wanted)
  const playerModule = useLazyModule(loadPlayer, wanted)

  const activity = useMemo<IslandActivity | null>(() => {
    if (!currentTrack || onPlayerPage || !compactModule || !playerModule)
      return null
    const { MusicCompact } = compactModule
    const { MiniPlayer } = playerModule
    if (showPlaying) {
      return {
        id: 'music',
        feature: 'music',
        hideable: true,
        sessionKey: String(currentTrack.id),
        standby: floatingOpen,
        priority: PLAYING_PRIORITY,
        label: t('music_playing', { title }),
        compact: <MusicCompact beat={settings.musicBeat} title={title} />,
        minimal: <AlbumNavIcon />,
        panel: <MiniPlayer />,
        panelClassName: MINI_PLAYER_POPOVER_CLASSNAME,
        panelStyle: MINI_PLAYER_POPOVER_STYLE,
        glow,
      }
    }
    if (!hasPlayed)
      return null
    return {
      id: 'music',
      feature: 'musicPaused',
      hideable: true,
      sessionKey: String(currentTrack.id),
      standby: floatingOpen,
      priority: PAUSED_PRIORITY,
      label: t('music_paused', { title }),
      // 与播放中是同一个组件：模糊封面底与封面不重新挂载，只换中间的文字与右侧的播放键，宽度随之以弹簧收放
      compact: <MusicCompact beat={settings.musicBeat} title={title} paused text={pausedLine ?? title} />,
      minimal: <AlbumNavIcon />,
      onPress: play,
    }
  }, [compactModule, currentTrack, floatingOpen, glow, hasPlayed, onPlayerPage, pausedLine, play, playerModule, settings.musicBeat, showPlaying, t, title])
  useIslandActivity(activity)

  // 开始播放或切歌时短暂显示歌名（同一首只提示一次）；歌词已经在唱（如从中段继续播放）时不提示，直接显示歌词。
  // 悬浮球的弹层开着时在弹层里切的歌，读者已经看到歌名，算作提示过
  const peekedRef = useRef<number | null>(null)
  useEffect(() => {
    if (!isPlaying || !currentTrack || onPlayerPage || peekedRef.current === currentTrack.id)
      return
    peekedRef.current = currentTrack.id
    if (lyricStarted || floatingOpen)
      return
    pushIslandAlert({
      key: PEEK_KEY,
      feature: 'musicPeek',
      // 消息类提示，而且歌词一开唱就会被 dismiss（见下面的 effect）：被反馈盖掉时直接丢弃，不用重播
      layer: 'notice',
      resume: 'drop',
      // 与胶囊平时一样的圆形封面（播放时转动）
      icon: currentTrack.albumPic ? <AlbumNavIcon /> : undefined,
      text: trackTitle(currentTrack),
      announce: t('music_now_playing', { title: trackTitle(currentTrack) }),
      duration: PEEK_MS,
    })
    // lyricStarted、floatingOpen 不放进依赖：只在切歌、开始播放时判断一次，歌词开唱后由下面的 effect 撤下提示
  }, [currentTrack, isPlaying, onPlayerPage, t])

  // 歌词一开唱、或打开了悬浮球的弹层，就撤下切歌提示
  useEffect(() => {
    if (lyricStarted || floatingOpen)
      dismissIslandAlert(PEEK_KEY)
  }, [currentTrack?.id, floatingOpen, lyricStarted])

  return null
}

/**
 * 按需加载一个模块：enabled 后才开始下载，加载完返回模块本身（之后一直保留），之前为 null。
 * 不用 next/dynamic：它首次渲染总会挂起一帧，胶囊与展开面板的形变要在挂上时就量到真实内容
 */
function useLazyModule<T>(load: () => Promise<T>, enabled: boolean): T | null {
  const [loaded, setLoaded] = useState<T | null>(null)
  useEffect(() => {
    if (!enabled || loaded)
      return
    let cancelled = false
    load().then((mod) => {
      if (!cancelled)
        setLoaded(mod)
    }, () => {
      // chunk 下载失败（离线、发版后旧 chunk 被清理）时不出音乐活动，下次 enabled 变化时重试
    })
    return () => {
      cancelled = true
    }
  }, [enabled, load, loaded])
  return loaded
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

/** 暂停时胶囊里的那一句（见 getLineTextAt）：间奏、开唱前、没有歌词时为 null；暂停期间拖动进度时跟着换；enabled 为 false 时不订阅播放进度 */
function usePausedLine(enabled: boolean) {
  const { lyrics } = useMusic()
  const clock = useMusicClockStore()
  const items = useMemo(() => buildTimeline(lyrics.lines), [lyrics.lines])
  const getSnapshot = useCallback(
    () => getLineTextAt(lyrics.lines, items, clock.getSnapshot() * 1000) ?? '',
    [clock, items, lyrics.lines],
  )
  return useSyncExternalStore(enabled ? clock.subscribe : noopSubscribe, enabled ? getSnapshot : emptySnapshot, emptySnapshot) || null
}

/**
 * 副歌描边的辉光（见 lib/lyrics/lyric-glow.ts）：颜色取此刻在唱的歌词，没有时取 fallback（封面主色）；enabled 为 false 时不订阅播放进度。
 * 随播放时钟（约每秒 4 次）读取，只在颜色或强弱变化时重渲染
 */
function useLyricGlow(enabled: boolean, fallback: string | null): IslandGlow | null {
  const { lyrics } = useMusic()
  const clock = useMusicClockStore()
  const getSnapshot = useCallback(() => {
    const { color, strong } = lyricGlowAt(lyrics, clock.getSnapshot() * 1000)
    return `${color ?? ''}|${strong ? 1 : 0}`
  }, [clock, lyrics])
  const key = useSyncExternalStore(enabled ? clock.subscribe : noopSubscribe, enabled ? getSnapshot : emptySnapshot, emptySnapshot)
  return useMemo(() => {
    if (!enabled)
      return null
    const [color, strong] = key.split('|')
    return { color: color || fallback || 'rgb(255 255 255)', strong: strong === '1' }
  }, [enabled, fallback, key])
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
