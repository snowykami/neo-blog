'use client'
import type { LyricCandidate, LyricSourceKind } from '@/lib/lyrics/resolve'
import type { LyricTrackInfo } from '@/lib/lyrics/strip-credits'
import type { LyricLine, ResolvedLyrics } from '@/lib/lyrics/types'
import type { MusicTrack } from '@/models/music'
import { useTranslations } from 'next-intl'
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { toast } from 'sonner'
import { fetchSongAudioURL } from '@/api/music'
import { applyEmphasis } from '@/lib/lyrics/emphasis'
import {
  findActiveLyricLineIndex,
  getLyricLineText,
  getVocalLyricLines,
  LYRIC_PLACEHOLDERS,
} from '@/lib/lyrics/line-utils'
import { requestRhythm } from '@/lib/lyrics/rhythm/source'
import { registerTelemetryContext } from '@/lib/telemetry/context'
import { requestLyricAnnotations, useLyricAnnotations, useLyricAnnotationsGenerating } from './lyric-annotations'
import { refreshSongLyrics, useResolvedSongLyrics } from './song-lyrics'

export type PlayMode = 'repeat-all' | 'repeat-one' | 'shuffle'

/** 稳定动作集合：所有函数引用在 Provider 生命周期内保持稳定，订阅不会触发重渲染 */
export interface MusicActionsValue {
  getAudio: () => HTMLAudioElement | null
  // 播放列表操作
  replacePlaylist: (tracks: MusicTrack[], startIndex?: number, startTime?: number) => void
  updatePlaylist: (tracks: MusicTrack[]) => void
  markPlaylistFailed: () => void
  deferPlaylist: (load: () => Promise<MusicTrack[]>, partial: boolean) => void
  ensurePlaylist: () => Promise<boolean>
  // 播放控制
  playTrack: (index: number, startTime?: number) => void
  playSong: (track: MusicTrack, startTime?: number) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  next: () => void
  prev: () => void
  setPlayMode: (m: PlayMode) => void
  seek: (seconds: number) => void
  // 音量与偏好操作
  setVolume: (v: number) => void
  adjustVolume: (delta: number) => void
  toggleMuted: () => void
  setShowTranslation: (show: boolean) => void
  setShowRomaji: (show: boolean) => void
  setShowLyricEffects: (show: boolean) => void
  setShowLyricMoments: (show: boolean) => void
  setHdr: (enabled: boolean) => void
  refreshLyrics: () => void
}

/** 低频核心播放与歌单状态（与歌词 SSE 瀑布流、音量滑块隔离） */
export interface MusicPlaybackValue {
  playlist: MusicTrack[]
  currentIndex: number | null
  currentTrack: MusicTrack | null
  isPlaying: boolean
  playMode: PlayMode
  duration: number | null
  playlistComplete: boolean
  playlistLoading: boolean
  pendingStep: 1 | -1 | null
  playlistState: 'pending' | 'loaded' | 'failed'
}

/** 音量状态与控制（拖动滑块时高频更新，仅音量控件订阅） */
export interface MusicVolumeValue {
  volume: number
  isMuted: boolean
  setVolume: (v: number) => void
  adjustVolume: (delta: number) => void
  toggleMuted: () => void
}

/** 界面显示偏好开关（翻译、音译、强调特效、热评时刻、HDR 高光） */
export interface MusicPreferencesValue {
  showTranslation: boolean
  showRomaji: boolean
  showLyricEffects: boolean
  showLyricMoments: boolean
  hdr: boolean
  setShowTranslation: (show: boolean) => void
  setShowRomaji: (show: boolean) => void
  setShowLyricEffects: (show: boolean) => void
  setShowLyricMoments: (show: boolean) => void
  setHdr: (enabled: boolean) => void
}

/** 当前曲目的歌词瀑布流与 AI 标注状态 */
export interface MusicLyricsValue {
  lyricCursor: LyricCursor
  // 最终显示歌词的主唱行（过滤掉背景和声行，标准 LyricLine 结构）
  lyricLines: LyricLine[]
  lyricStatus: 'loading' | 'ready' | 'none'
  lyrics: ResolvedLyrics
  lyricCandidates: LyricCandidate[]
  lyricKind: LyricSourceKind | null
  lyricSiteKind: LyricSourceKind | null
  lyricIsSiteVersion: boolean
  lyricSourcesPending: boolean
  refreshLyrics: () => void
  lyricAnnotated: boolean
  lyricAnnotationsGenerating: boolean
  hasTranslationLyric: boolean
  hasRomajiLyric: boolean
}

/**
 * 聚合门面接口（向后兼容）：合并播放、音量、偏好、歌词与动作。
 * 单一职责的高频受影响组件建议优先使用 useMusicPlayback / useMusicPreferences / useMusicVolume / useMusicLyrics / useMusicActions
 */
export type MusicContextValue
  = & MusicPlaybackValue
    & MusicVolumeValue
    & MusicPreferencesValue
    & MusicLyricsValue
    & MusicActionsValue

/** 播放时钟：音频进度的外部 store，随 timeupdate（约 4 次/秒）、跳转与切歌更新，不经过 context value */
export interface MusicClock {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => number
}

/** 当前歌词行的外部 store：值为 lyricLines 中的下标，没有时为 null */
export interface LyricCursor {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => number | null
}

/** 只在值变化时通知订阅者的外部 store（播放时钟与当前歌词行） */
function createValueStore<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => value,
    set: (next: T) => {
      if (Object.is(next, value))
        return
      value = next
      listeners.forEach(listener => listener())
    },
  }
}

function createMusicClock() {
  return createValueStore(0)
}

function createLyricCursor() {
  return createValueStore<number | null>(null)
}

export const PLAY_MODES: PlayMode[] = ['repeat-all', 'repeat-one', 'shuffle']

/** 播放模式按 列表循环 → 单曲循环 → 随机 依次切换 */
export function getNextPlayMode(mode: PlayMode): PlayMode {
  return PLAY_MODES[(PLAY_MODES.indexOf(mode) + 1) % PLAY_MODES.length]
}

// MediaSession 标题（当前歌词）的最短更新间隔
const MEDIA_SESSION_MIN_INTERVAL_MS = 1000

// 提示的 id：连续失败（如连按几次下一首、自动下一首也失败）时只显示一条
const PLAYLIST_FAILED_TOAST_ID = 'music-playlist-failed'
const PLAYBACK_FAILED_TOAST_ID = 'music-playback-failed'
// MediaError.MEDIA_ERR_ABORTED：读者或代码中止了加载（如切歌），不算出错
const MEDIA_ERR_ABORTED = 1
// 自动切歌熔断阈值（见 spec 5.2）：单首至少实际出声播放满 MIN_VALID_PLAY_MS 才算正常播放；
// 未主动定位到曲末而连续异常 ended 达 MAX_ABNORMAL_AUTO_SKIPS 次，或系统媒体控制未出声连续快速切歌达 MAX_MEDIA_SESSION_STORM_SKIPS 次时停播熔断
export const MIN_VALID_PLAY_MS = 2000
export const MAX_ABNORMAL_AUTO_SKIPS = 3
const NEAR_END_SEEK_THRESHOLD_S = 5
const MEDIA_SESSION_STORM_WINDOW_MS = 1500
export const MAX_MEDIA_SESSION_STORM_SKIPS = 5

const STORAGE_KEY_PLAY_MODE = 'music-play-mode'
const STORAGE_KEY_SHOW_TRANSLATION = 'music-show-translation'
const STORAGE_KEY_SHOW_ROMAJI = 'music-show-romaji'
const STORAGE_KEY_SHOW_LYRIC_EFFECTS = 'music-show-lyric-effects'
const STORAGE_KEY_SHOW_LYRIC_MOMENTS = 'music-show-lyric-moments'
const STORAGE_KEY_HDR = 'music-hdr'
// 旧版的三选一歌词模式（none / romaji / translation），读取后迁移为两个开关
const LEGACY_STORAGE_KEY_LYRIC_MODE = 'music-lyric-mode'

function readStoredBoolean(key: string): boolean | null {
  const raw = localStorage.getItem(key)
  if (raw == null)
    return null
  const value = JSON.parse(raw)
  return typeof value === 'boolean' ? value : null
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  }
  catch { }
}

const MusicContext = createContext<MusicContextValue | null>(null)
const MusicClockContext = createContext<MusicClock | null>(null)
const MusicActionsContext = createContext<MusicActionsValue | null>(null)
const MusicPlaybackContext = createContext<MusicPlaybackValue | null>(null)
const MusicVolumeContext = createContext<MusicVolumeValue | null>(null)
const MusicPreferencesContext = createContext<MusicPreferencesValue | null>(null)
const MusicLyricsContext = createContext<MusicLyricsValue | null>(null)

export function useMusic(): MusicContextValue {
  const ctx = useContext(MusicContext)
  if (!ctx)
    throw new Error('useMusic must be used within MusicProvider')
  return ctx
}

export function useMusicActions(): MusicActionsValue {
  const ctx = useContext(MusicActionsContext)
  if (!ctx)
    throw new Error('useMusicActions must be used within MusicProvider')
  return ctx
}

export function useMusicPlayback(): MusicPlaybackValue {
  const ctx = useContext(MusicPlaybackContext)
  if (!ctx)
    throw new Error('useMusicPlayback must be used within MusicProvider')
  return ctx
}

export function useMusicVolume(): MusicVolumeValue {
  const ctx = useContext(MusicVolumeContext)
  if (!ctx)
    throw new Error('useMusicVolume must be used within MusicProvider')
  return ctx
}

export function useMusicPreferences(): MusicPreferencesValue {
  const ctx = useContext(MusicPreferencesContext)
  if (!ctx)
    throw new Error('useMusicPreferences must be used within MusicProvider')
  return ctx
}

export function useMusicLyrics(): MusicLyricsValue {
  const ctx = useContext(MusicLyricsContext)
  if (!ctx)
    throw new Error('useMusicLyrics must be used within MusicProvider')
  return ctx
}

/**
 * 按歌曲 id 取最终显示的歌词（与播放器、导航栏同一套来源与选择规则，读者不参与来源选择，一律按全站版本）；
 * id 为空时不请求。track 用于去掉「歌名 - 歌手」等署名行
 */
export function useSongLyrics(id: number | null, track?: LyricTrackInfo | null) {
  return useResolvedSongLyrics(id, track)
}

/** 播放时钟本身：需要在回调中读取进度（如定期保存进度）而不想因此重渲染时使用 */
export function useMusicClockStore(): MusicClock {
  const clock = useContext(MusicClockContext)
  if (!clock)
    throw new Error('useMusicClockStore must be used within MusicProvider')
  return clock
}

const noopSubscribe = () => () => {}
const zeroSnapshot = () => 0
const nullSnapshot = () => null

/**
 * 当前播放进度（秒），约每秒更新 4 次，只让订阅的组件重渲染。
 * enabled 为 false 时不订阅（如不是当前曲目的音乐卡片），始终返回 0；
 * 逐帧动画（歌词擦除等）应在 requestAnimationFrame 中直接读 getAudio().currentTime
 */
export function useMusicClock(enabled = true): number {
  const clock = useMusicClockStore()
  return useSyncExternalStore(
    enabled ? clock.subscribe : noopSubscribe,
    enabled ? clock.getSnapshot : zeroSnapshot,
    zeroSnapshot,
  )
}

/** 当前歌词行在 lyricLines 中的下标，只在换行时触发重渲染；enabled 为 false 时不订阅（始终为 null） */
export function useCurrentLyricIndex(enabled = true): number | null {
  const { lyricCursor } = useMusicLyrics()
  return useSyncExternalStore(
    enabled ? lyricCursor.subscribe : noopSubscribe,
    enabled ? lyricCursor.getSnapshot : nullSnapshot,
    nullSnapshot,
  )
}

/** 当前歌词行的文字；enabled 为 false 时不订阅（始终为 null） */
export function useCurrentLyric(enabled = true): string | null {
  const { lyricLines } = useMusicLyrics()
  const index = useCurrentLyricIndex(enabled)
  if (index == null || !lyricLines[index])
    return null
  return getLyricLineText(lyricLines[index]).trim()
}

/**
 * 计算相邻曲目索引：direction 为 1 表示下一首，-1 表示上一首；随机模式下尽量避开当前曲目
 */
function getAdjacentIndex(list: MusicTrack[], curr: number | null, mode: PlayMode, direction: 1 | -1): number | null {
  if (list.length === 0)
    return null
  if (mode === 'shuffle') {
    if (list.length === 1)
      return 0
    let idx = Math.floor(Math.random() * list.length)
    if (idx === curr)
      idx = (idx + 1) % list.length
    return idx
  }
  if (curr == null)
    return direction === 1 ? 0 : list.length - 1
  return (curr + direction + list.length) % list.length
}

// 播放地址在后端缓存 10 分钟：预取过的歌曲超过这个时间再经过时重新预取
export const PREFETCH_TTL_MS = 10 * 60 * 1000

/** 是否需要预取这首歌的播放地址：没预取过，或上次预取已超过后端缓存的有效期 */
export function shouldPrefetch(prefetched: Map<number, number>, id: number, now: number): boolean {
  const at = prefetched.get(id)
  if (at != null && now - at < PREFETCH_TTL_MS)
    return false
  // 顺手清掉过期的记录，循环播放很久也不会一直变大
  for (const [key, time] of prefetched) {
    if (now - time >= PREFETCH_TTL_MS)
      prefetched.delete(key)
  }
  return true
}

/**
 * 换上新版本的歌单时重新定位当前曲目，保证不换歌：当前曲目在新歌单中时取新歌单中的位置；
 * 已被移出歌单时把它留在原来的位置（读者切到别的歌之后，下次加载歌单就不再有它），不跳到第一首
 */
export function rebasePlaylist(tracks: MusicTrack[], current: MusicTrack | null, currentIndex: number | null): { tracks: MusicTrack[], index: number | null } {
  if (!current)
    return { tracks, index: tracks.length > 0 ? 0 : null }
  const index = tracks.findIndex(track => track.id === current.id)
  if (index >= 0)
    return { tracks, index }
  const insertAt = Math.max(0, Math.min(currentIndex ?? 0, tracks.length))
  return { tracks: [...tracks.slice(0, insertAt), current, ...tracks.slice(insertAt)], index: insertAt }
}

/** MediaSession 封面：无封面时返回空数组，避免浏览器因空 src 报错 */
function makeMediaArtwork(url?: string) {
  if (!url)
    return []
  return [
    { src: url, sizes: '512x512', type: 'image/png' },
    { src: url, sizes: '96x96', type: 'image/png' },
  ]
}

/**
 * 同步 MediaSession 元数据：播放中若能拿到有效歌词，标题就用当前歌词，否则回退到曲目名；
 * 暂停时恢复为曲目名，避免锁屏/控制中心一直挂着一句悬空的歌词
 */
function updateMediaSessionMetadata(
  ms: MediaSession,
  track: MusicTrack | null,
  lyric: string | null,
  playing: boolean,
) {
  if (!track) {
    try {
      ms.metadata = null
    }
    catch { }
    ms.playbackState = 'none'
    return
  }

  const lyricTitle = playing && lyric ? lyric.trim() : ''
  const hasLyricTitle = lyricTitle.length > 0 && !LYRIC_PLACEHOLDERS.has(lyricTitle)
  const metadata = {
    title: hasLyricTitle ? lyricTitle : (track.name ?? ''),
    artist: Array.isArray(track.artists) ? track.artists.join(', ') : (track.artists ?? ''),
    album: track.album ?? '',
    artwork: makeMediaArtwork(track.albumPic),
  }

  try {
    ms.metadata = new MediaMetadata(metadata)
  }
  catch {
    try {
      ms.metadata = metadata as MediaMetadata
    }
    catch { }
  }
  ms.playbackState = playing ? 'playing' : 'paused'
}

export const MusicProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingPlayRef = useRef(false)
  // 待恢复的播放进度：仅当音频元数据就绪且当前曲目 id 一致时才应用，避免进度被应用到别的曲目上
  const pendingSeekRef = useRef<{ trackId: number, time: number } | null>(null)
  const prevTrackIdRef = useRef<number | null>(null)
  const [playlist, setPlaylist] = useState<MusicTrack[]>([])
  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playMode, setPlayModeState] = useState<PlayMode>('repeat-all')
  // 播放时钟：进度不进 React 状态，见 useMusicClock
  const [clock] = useState(createMusicClock)
  const [lyricCursor] = useState(createLyricCursor)
  const [duration, setDuration] = useState<number | null>(null)
  const [volume, setVolumeState] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  // 翻译与音译默认都打开；读者切换后的选择保存在本地，以读者的选择为准
  const [showTranslation, setShowTranslationState] = useState(true)
  const [showRomaji, setShowRomajiState] = useState(true)
  const [showLyricEffects, setShowLyricEffectsState] = useState(true)
  // 热评与旁白默认显示，读者关掉后记在本地
  const [showLyricMoments, setShowLyricMomentsState] = useState(true)
  // HDR 高光默认开启；若有读者反馈卡顿再改为默认关闭
  const [hdr, setHdrState] = useState(true)
  const currentTrack = currentIndex != null ? playlist[currentIndex] ?? null : null
  const currentTrackId = currentTrack?.id ?? null
  const getAudio = useCallback(() => audioRef.current, [])
  // 补全歌单失败、播放出错时的提示：在音频事件与切歌回调里使用，经 ref 读取，不让这些回调随语言切换重建
  const t = useTranslations('MusicPlayer')
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  // 错误报告与崩溃补报附带正在播放的歌曲与位置（见 lib/telemetry/context.ts）
  useEffect(() => registerTelemetryContext('music', () => {
    const audio = audioRef.current
    return currentTrack
      ? { track_id: currentTrack.id, track: currentTrack.name, position_s: audio ? Math.round(audio.currentTime) : null, playing: audio ? !audio.paused : false }
      : null
  }), [currentTrack])

  // 供事件回调读取最新值，避免闭包拿到过期的 playlist / index / mode
  const playlistRef = useRef(playlist)
  const currentIndexRef = useRef(currentIndex)
  const playModeRef = useRef(playMode)
  useEffect(() => {
    playlistRef.current = playlist
    currentIndexRef.current = currentIndex
    playModeRef.current = playMode
  }, [playlist, currentIndex, playMode])

  // 创建 audio 元素并恢复本地偏好（仅在客户端首次挂载时执行）
  useEffect(() => {
    if (typeof window === 'undefined')
      return

    if (!audioRef.current) {
      const audio = new Audio()
      audio.preload = 'metadata'
      audioRef.current = audio
    }

    try {
      const storedVolume = localStorage.getItem('music-volume')
      if (storedVolume != null) {
        const nextVolume = Math.max(0, Math.min(1, Number(JSON.parse(storedVolume))))
        if (Number.isFinite(nextVolume)) {
          setVolumeState(nextVolume)
          audioRef.current.volume = nextVolume
        }
      }

      const storedMuted = localStorage.getItem('music-muted')
      if (storedMuted != null) {
        const nextMuted = Boolean(JSON.parse(storedMuted))
        setIsMuted(nextMuted)
        audioRef.current.muted = nextMuted
      }

      const storedPlayMode = JSON.parse(localStorage.getItem(STORAGE_KEY_PLAY_MODE) ?? 'null')
      if (PLAY_MODES.includes(storedPlayMode))
        setPlayModeState(storedPlayMode)

      const storedEffects = readStoredBoolean(STORAGE_KEY_SHOW_LYRIC_EFFECTS)
      if (storedEffects != null)
        setShowLyricEffectsState(storedEffects)

      const storedMoments = readStoredBoolean(STORAGE_KEY_SHOW_LYRIC_MOMENTS)
      if (storedMoments != null)
        setShowLyricMomentsState(storedMoments)

      const storedHdr = readStoredBoolean(STORAGE_KEY_HDR)
      if (storedHdr != null)
        setHdrState(storedHdr)

      const storedTranslation = readStoredBoolean(STORAGE_KEY_SHOW_TRANSLATION)
      const storedRomaji = readStoredBoolean(STORAGE_KEY_SHOW_ROMAJI)
      if (storedTranslation != null || storedRomaji != null) {
        if (storedTranslation != null)
          setShowTranslationState(storedTranslation)
        if (storedRomaji != null)
          setShowRomajiState(storedRomaji)
      }
      else {
        // 迁移旧版的三选一歌词模式
        const legacyMode = localStorage.getItem(LEGACY_STORAGE_KEY_LYRIC_MODE)
        if (legacyMode != null) {
          const mode = JSON.parse(legacyMode)
          setShowTranslationState(mode === 'translation')
          setShowRomajiState(mode === 'romaji')
          localStorage.removeItem(LEGACY_STORAGE_KEY_LYRIC_MODE)
        }
      }
    }
    catch (error) {
      console.error('Failed to restore music preferences:', error)
    }
  }, [])

  useEffect(() => {
    if (!audioRef.current)
      return
    audioRef.current.volume = volume
    audioRef.current.muted = isMuted
  }, [isMuted, volume])

  // 单曲实际出声时长统计与自动切歌熔断（见 spec 5.2）：防止浏览器缓存异常、空音频流或系统媒体会话失控导致「不播放、无限切歌」
  const playedMsRef = useRef(0)
  const playingSinceRef = useRef<number | null>(null)
  const seekedNearEndRef = useRef(false)
  const abnormalEndCountRef = useRef(0)
  const mediaStormCountRef = useRef(0)
  const lastMediaSkipAtRef = useRef(0)
  const circuitTrippedRef = useRef(false)

  const resetTrackPlayStats = useCallback(() => {
    playedMsRef.current = 0
    playingSinceRef.current = null
    seekedNearEndRef.current = false
  }, [])

  const flushTrackPlayTimer = useCallback(() => {
    if (playingSinceRef.current != null) {
      playedMsRef.current += Math.max(0, performance.now() - playingSinceRef.current)
      playingSinceRef.current = null
    }
    return playedMsRef.current
  }, [])

  const getPlayedMs = useCallback(() => {
    const active = playingSinceRef.current != null ? Math.max(0, performance.now() - playingSinceRef.current) : 0
    return playedMsRef.current + active
  }, [])

  const resetCircuitBreaker = useCallback(() => {
    abnormalEndCountRef.current = 0
    mediaStormCountRef.current = 0
    lastMediaSkipAtRef.current = 0
  }, [])

  // 仅在曲目 id 变化时切换 audio.src，并在 pendingPlay 时尝试播放
  useEffect(() => {
    const audio = audioRef.current
    if (!audio)
      return
    if (currentTrackId == null) {
      if (prevTrackIdRef.current != null) {
        resetTrackPlayStats()
        audio.removeAttribute('src')
        audio.load()
        prevTrackIdRef.current = null
      }
      return
    }
    if (prevTrackIdRef.current === currentTrackId)
      return

    const track = playlistRef.current[currentIndexRef.current ?? -1]
    prevTrackIdRef.current = currentTrackId
    resetTrackPlayStats()
    // 切换曲目时重置时长与进度，避免进度条短暂沿用上一首的时长
    setDuration(null)
    clock.set(0)
    audio.src = track?.audio || ''
    audio.currentTime = 0
    if (pendingPlayRef.current) {
      pendingPlayRef.current = false
      void audio.play().catch(() => {
        /* play 可能被浏览器阻止（自动播放策略），事件监听会同步状态 */
      })
    }
  }, [clock, currentTrackId, resetTrackPlayStats])

  // 节拍分析（韵律动效）：开启歌词特效时分析当前曲目，结果按歌曲缓存
  const currentTrackAudio = currentTrack?.audio ?? null
  useEffect(() => {
    const audio = audioRef.current
    if (!showLyricEffects || currentTrackId == null || !audio)
      return
    const controller = new AbortController()
    const request = () => {
      if (!audio.paused && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && document.visibilityState === 'visible')
        requestRhythm(currentTrackId, currentTrackAudio, controller.signal)
    }
    request()
    audio.addEventListener('playing', request)
    document.addEventListener('visibilitychange', request)
    return () => {
      controller.abort()
      audio.removeEventListener('playing', request)
      document.removeEventListener('visibilitychange', request)
    }
  }, [currentTrackAudio, currentTrackId, showLyricEffects])

  // 歌单的加载状态
  const [playlistState, setPlaylistState] = useState<'pending' | 'loaded' | 'failed'>('pending')
  const markPlaylistFailed = useCallback(() => {
    setPlaylistState(state => (state === 'loaded' ? state : 'failed'))
  }, [])

  const updatePlaylist = useCallback((tracks: MusicTrack[]) => {
    const index = currentIndexRef.current
    const current = index == null ? null : playlistRef.current[index] ?? null
    const next = rebasePlaylist(tracks, current, index)
    playlistRef.current = next.tracks
    currentIndexRef.current = next.index
    setPlaylist(next.tracks)
    setCurrentIndex(next.index)
    setPlaylistState('loaded')
  }, [])

  // 待取的完整歌单（见 deferPlaylist）：取到后换上（不换歌、不动进度，见 updatePlaylist）
  const [playlistComplete, setPlaylistComplete] = useState(true)
  const playlistCompleteRef = useRef(true)
  const [playlistLoading, setPlaylistLoading] = useState(false)
  const deferredPlaylistRef = useRef<(() => Promise<MusicTrack[]>) | null>(null)
  const playlistLoadingRef = useRef<Promise<boolean> | null>(null)
  const playlistWantedRef = useRef(false)
  const ensurePlaylistRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))

  const ensurePlaylist = useCallback((): Promise<boolean> => {
    const load = deferredPlaylistRef.current
    if (!load) {
      playlistWantedRef.current = true
      return Promise.resolve(playlistCompleteRef.current)
    }
    if (playlistLoadingRef.current)
      return playlistLoadingRef.current
    setPlaylistLoading(true)
    const loading: Promise<boolean> = load()
      .then((tracks) => {
        if (deferredPlaylistRef.current !== load)
          return deferredPlaylistRef.current ? ensurePlaylistRef.current() : playlistCompleteRef.current
        deferredPlaylistRef.current = null
        playlistWantedRef.current = false
        updatePlaylist(tracks)
        playlistCompleteRef.current = true
        setPlaylistComplete(true)
        return true
      })
      .catch((error) => {
        console.error('Failed to fetch playlist:', error)
        return playlistCompleteRef.current
      })
      .finally(() => {
        if (playlistLoadingRef.current === loading) {
          playlistLoadingRef.current = null
          setPlaylistLoading(false)
        }
      })
    playlistLoadingRef.current = loading
    return loading
  }, [updatePlaylist])
  useEffect(() => {
    ensurePlaylistRef.current = ensurePlaylist
  }, [ensurePlaylist])

  const deferPlaylist = useCallback((load: () => Promise<MusicTrack[]>, partial: boolean) => {
    deferredPlaylistRef.current = load
    playlistLoadingRef.current = null
    setPlaylistLoading(false)
    playlistCompleteRef.current = !partial
    setPlaylistComplete(!partial)
    if (playlistWantedRef.current)
      void ensurePlaylist()
  }, [ensurePlaylist])

  const prefetchedTrackIds = useRef<Map<number, number>>(new Map())

  useEffect(() => {
    const audio = audioRef.current
    if (!currentTrack || !audio)
      return
    const request = () => {
      if (audio.paused || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA)
        return
      if (deferredPlaylistRef.current) {
        void ensurePlaylist()
        return
      }
      if (document.visibilityState !== 'visible')
        return
      if (playModeRef.current === 'shuffle')
        return
      const nextIndex = getAdjacentIndex(playlistRef.current, currentIndexRef.current, playModeRef.current, 1)
      const next = nextIndex == null ? null : playlistRef.current[nextIndex]
      if (!next || next.id === currentTrack.id || !shouldPrefetch(prefetchedTrackIds.current, next.id, Date.now()))
        return
      prefetchedTrackIds.current.set(next.id, Date.now())
      fetchSongAudioURL(next.id).catch(() => prefetchedTrackIds.current.delete(next.id))
    }
    request()
    audio.addEventListener('playing', request)
    document.addEventListener('visibilitychange', request)
    return () => {
      audio.removeEventListener('playing', request)
      document.removeEventListener('visibilitychange', request)
    }
  }, [currentTrack, ensurePlaylist])

  const goTo = useCallback((index: number | null, autoplay: boolean, startTime?: number) => {
    if (index == null) {
      currentIndexRef.current = null
      pendingSeekRef.current = null
      setCurrentIndex(null)
      return
    }
    const audio = audioRef.current
    const track = playlistRef.current[index]
    const pendingSeek = track && startTime != null && Number.isFinite(startTime) && startTime >= 0
      ? { trackId: track.id, time: startTime }
      : null
    if (index === currentIndexRef.current) {
      pendingSeekRef.current = null
      resetTrackPlayStats()
      if (audio) {
        if (pendingSeek) {
          if (Number.isFinite(audio.duration) && audio.duration > 0 && pendingSeek.time >= audio.duration - NEAR_END_SEEK_THRESHOLD_S)
            seekedNearEndRef.current = true
          try {
            audio.currentTime = Math.max(0, Math.min(pendingSeek.time, audio.duration || pendingSeek.time))
          }
          catch { }
          clock.set(pendingSeek.time)
        }
        else {
          audio.currentTime = 0
        }
        if (autoplay)
          void audio.play().catch(() => { })
      }
      return
    }
    pendingSeekRef.current = pendingSeek
    pendingPlayRef.current = autoplay
    currentIndexRef.current = index
    setCurrentIndex(index)
  }, [clock, resetTrackPlayStats])

  const switchSeqRef = useRef(0)
  const pendingStepCountRef = useRef(0)
  const [pendingStep, setPendingStep] = useState<1 | -1 | null>(null)
  const supersedeSteps = useCallback(() => {
    switchSeqRef.current++
    pendingStepCountRef.current = 0
    setPendingStep(null)
  }, [])

  const step = useCallback((direction: 1 | -1) => {
    const go = () => goTo(getAdjacentIndex(playlistRef.current, currentIndexRef.current, playModeRef.current, direction), true)
    if (playlistCompleteRef.current) {
      go()
      return
    }
    const seq = switchSeqRef.current
    pendingStepCountRef.current++
    setPendingStep(direction)
    void ensurePlaylist().then((complete) => {
      if (seq !== switchSeqRef.current)
        return
      pendingStepCountRef.current--
      if (pendingStepCountRef.current <= 0) {
        pendingStepCountRef.current = 0
        setPendingStep(null)
      }
      if (!complete) {
        toast.error(tRef.current('playlist_load_failed'), { id: PLAYLIST_FAILED_TOAST_ID })
        return
      }
      go()
    })
  }, [ensurePlaylist, goTo])

  const tripCircuitBreaker = useCallback(() => {
    resetCircuitBreaker()
    flushTrackPlayTimer()
    circuitTrippedRef.current = true
    pendingPlayRef.current = false
    supersedeSteps()
    const audio = audioRef.current
    if (audio && !audio.paused)
      audio.pause()
    setIsPlaying(false)
    toast.error(tRef.current('playback_circuit_broken'), { id: PLAYBACK_FAILED_TOAST_ID })
  }, [flushTrackPlayTimer, resetCircuitBreaker, supersedeSteps])

  const startAudio = useCallback((audio: HTMLAudioElement) => {
    resetCircuitBreaker()
    const wasTripped = circuitTrippedRef.current
    if (wasTripped || (audio.error && audio.error.code !== MEDIA_ERR_ABORTED)) {
      circuitTrippedRef.current = false
      resetTrackPlayStats()
      const time = audio.currentTime
      if (!wasTripped && prevTrackIdRef.current != null && time > 0 && !pendingSeekRef.current)
        pendingSeekRef.current = { trackId: prevTrackIdRef.current, time }
      audio.load()
    }
    void audio.play().catch(() => {
      /* 失败或被阻止，事件监听会同步状态 */
    })
  }, [resetCircuitBreaker, resetTrackPlayStats])

  // 统一通过 audio 事件驱动上下文状态（isPlaying / time / duration）
  useEffect(() => {
    const audio = audioRef.current
    if (!audio)
      return

    const onPlay = () => {
      setIsPlaying(true)
    }
    const onPlaying = () => {
      playingSinceRef.current ??= performance.now()
    }
    const onPause = () => {
      flushTrackPlayTimer()
      setIsPlaying(false)
    }
    const onWaiting = () => {
      flushTrackPlayTimer()
    }

    const onLoaded = () => {
      const pendingSeek = pendingSeekRef.current
      if (pendingSeek && pendingSeek.trackId === prevTrackIdRef.current && Number.isFinite(audio.duration) && audio.duration > 0) {
        pendingSeekRef.current = null
        if (pendingSeek.time >= audio.duration - NEAR_END_SEEK_THRESHOLD_S)
          seekedNearEndRef.current = true
        try {
          audio.currentTime = Math.max(0, Math.min(pendingSeek.time, audio.duration))
        }
        catch { }
      }
      setDuration(Number.isFinite(audio.duration) ? audio.duration : null)
      clock.set(audio.currentTime ?? 0)
    }
    // timeupdate 本身约每秒 4 次；跳转完成时立即同步一次；正常播放满阈值后清零异常计数
    const onTimeUpdate = () => {
      clock.set(audio.currentTime)
      if (!audio.paused && getPlayedMs() >= MIN_VALID_PLAY_MS)
        resetCircuitBreaker()
    }
    const onError = () => {
      const error = audio.error
      if (!error || error.code === MEDIA_ERR_ABORTED)
        return
      flushTrackPlayTimer()
      const wanted = !audio.paused || pendingPlayRef.current
      pendingPlayRef.current = false
      if (!audio.paused)
        audio.pause()
      setIsPlaying(false)
      if (wanted)
        toast.error(tRef.current('playback_failed'), { id: PLAYBACK_FAILED_TOAST_ID })
    }
    const onEnded = () => {
      const playedMs = flushTrackPlayTimer()
      const track = playlistRef.current[currentIndexRef.current ?? -1]
      const expectedMs = track?.duration && track.duration > 0 ? track.duration : 0
      const minRequiredMs = expectedMs > 0 ? Math.min(MIN_VALID_PLAY_MS, expectedMs * 0.5) : MIN_VALID_PLAY_MS
      if (playedMs >= minRequiredMs || seekedNearEndRef.current) {
        resetCircuitBreaker()
      }
      else {
        abnormalEndCountRef.current++
        if (abnormalEndCountRef.current >= MAX_ABNORMAL_AUTO_SKIPS) {
          tripCircuitBreaker()
          return
        }
      }
      if (playModeRef.current === 'repeat-one') {
        resetTrackPlayStats()
        audio.currentTime = 0
        void audio.play().catch(() => { })
        return
      }
      step(1)
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('seeked', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('seeked', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [clock, flushTrackPlayTimer, getPlayedMs, resetCircuitBreaker, resetTrackPlayStats, step, tripCircuitBreaker])

  // 当前曲目的歌词：与文章内的单曲卡、歌词摘录共用同一份来源与选择结果（见 contexts/song-lyrics.ts）
  const songLyrics = useResolvedSongLyrics(currentTrackId, currentTrack)
  const wantsAnnotations = isPlaying && showLyricEffects && songLyrics.lyrics.wordTimed && songLyrics.isSiteVersion && currentTrackId != null && currentTrackId > 0
  useEffect(() => {
    if (wantsAnnotations && currentTrackId != null)
      requestLyricAnnotations(currentTrackId)
  }, [currentTrackId, wantsAnnotations])
  const storedAnnotations = useLyricAnnotations(currentTrackId)
  const annotations = storedAnnotations?.source === songLyrics.lyrics.source ? storedAnnotations : null
  const lyrics = useMemo(() => applyEmphasis(songLyrics.lyrics, annotations), [annotations, songLyrics.lyrics])
  const refreshLyrics = useCallback(() => {
    const id = playlistRef.current[currentIndexRef.current ?? -1]?.id
    if (id != null)
      refreshSongLyrics(id)
  }, [])
  const lyricAnnotationsGenerating = useLyricAnnotationsGenerating(showLyricEffects && songLyrics.lyrics.wordTimed && songLyrics.isSiteVersion ? currentTrackId : null)
  const lyricAnnotated = showLyricEffects && songLyrics.lyrics.wordTimed && (annotations?.lines.length ?? 0) > 0
  const lyricCandidates = songLyrics.candidates
  const lyricKind = songLyrics.kind
  const lyricSiteKind = songLyrics.siteKind
  const lyricIsSiteVersion = songLyrics.isSiteVersion
  const lyricsPending = songLyrics.pending
  const lyricStatus = songLyrics.status

  // 当前歌词主唱行（标准 LyricLine[]）：订阅播放时钟，只在换行时更新外部 store
  const lyricLines = useMemo(() => getVocalLyricLines(lyrics.lines), [lyrics.lines])
  useEffect(() => {
    const update = () => lyricCursor.set(lyricLines.length === 0
      ? null
      : findActiveLyricLineIndex(lyricLines, clock.getSnapshot() * 1000, null))
    update()
    return clock.subscribe(update)
  }, [clock, lyricCursor, lyricLines])

  // 操作函数 —— 不直接 set isPlaying/currentTime（由事件回路同步）
  const replacePlaylist = useCallback((tracks: MusicTrack[], startIndex = 0, startTime?: number) => {
    supersedeSteps()
    resetCircuitBreaker()
    circuitTrippedRef.current = false
    const index = tracks.length > 0 ? Math.max(0, Math.min(startIndex, tracks.length - 1)) : null
    const track = index == null ? null : tracks[index]
    pendingSeekRef.current = track && startTime != null && Number.isFinite(startTime) && startTime > 0
      ? { trackId: track.id, time: startTime }
      : null
    const audio = audioRef.current
    if (audio && pendingSeekRef.current && pendingSeekRef.current.trackId === prevTrackIdRef.current && audio.readyState >= 1) {
      if (Number.isFinite(audio.duration) && audio.duration > 0 && pendingSeekRef.current.time >= audio.duration - NEAR_END_SEEK_THRESHOLD_S)
        seekedNearEndRef.current = true
      try {
        audio.currentTime = Math.max(0, Math.min(pendingSeekRef.current.time, audio.duration || pendingSeekRef.current.time))
      }
      catch { }
      pendingSeekRef.current = null
    }
    playlistRef.current = tracks
    currentIndexRef.current = index
    setPlaylist(tracks)
    setCurrentIndex(index)
    setPlaylistState('loaded')
  }, [resetCircuitBreaker, supersedeSteps])

  const playTrack = useCallback((index: number, startTime?: number) => {
    if (index < 0 || index >= playlistRef.current.length)
      return
    supersedeSteps()
    resetCircuitBreaker()
    circuitTrippedRef.current = false
    if (startTime != null) {
      goTo(index, true, startTime)
      return
    }
    if (index === currentIndexRef.current) {
      if (audioRef.current)
        startAudio(audioRef.current)
      return
    }
    goTo(index, true)
  }, [goTo, resetCircuitBreaker, startAudio, supersedeSteps])

  const playSong = useCallback((track: MusicTrack, startTime?: number) => {
    supersedeSteps()
    resetCircuitBreaker()
    circuitTrippedRef.current = false
    const existing = playlistRef.current.findIndex(item => item.id === track.id)
    if (existing >= 0) {
      playTrack(existing, startTime)
      return
    }
    const insertAt = (currentIndexRef.current ?? -1) + 1
    const tracks = [...playlistRef.current.slice(0, insertAt), track, ...playlistRef.current.slice(insertAt)]
    playlistRef.current = tracks
    setPlaylist(tracks)
    goTo(insertAt, true, startTime)
  }, [goTo, playTrack, resetCircuitBreaker, supersedeSteps])

  const play = useCallback(() => {
    const audio = audioRef.current
    if (!audio)
      return
    startAudio(audio)
  }, [startAudio])

  const pause = useCallback(() => {
    const audio = audioRef.current
    if (!audio)
      return
    audio.pause()
  }, [])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio)
      return
    if (audio.paused)
      startAudio(audio)
    else
      audio.pause()
  }, [startAudio])

  const next = useCallback(() => {
    resetCircuitBreaker()
    circuitTrippedRef.current = false
    step(1)
  }, [resetCircuitBreaker, step])

  const prev = useCallback(() => {
    resetCircuitBreaker()
    circuitTrippedRef.current = false
    step(-1)
  }, [resetCircuitBreaker, step])

  const mediaSessionStep = useCallback((direction: 1 | -1) => {
    const now = performance.now()
    if (getPlayedMs() < MIN_VALID_PLAY_MS && lastMediaSkipAtRef.current > 0 && now - lastMediaSkipAtRef.current < MEDIA_SESSION_STORM_WINDOW_MS) {
      mediaStormCountRef.current++
      if (mediaStormCountRef.current >= MAX_MEDIA_SESSION_STORM_SKIPS) {
        tripCircuitBreaker()
        return
      }
    }
    else {
      mediaStormCountRef.current = 1
    }
    lastMediaSkipAtRef.current = now
    step(direction)
  }, [getPlayedMs, step, tripCircuitBreaker])

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio)
      return
    seekedNearEndRef.current = true
    clock.set(Math.max(0, Math.min(seconds, audio.duration || seconds)))
    try {
      audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds))
    }
    catch {
    }
  }, [clock])

  const setVolume = useCallback((v: number) => {
    const audio = audioRef.current
    const nextVolume = Math.max(0, Math.min(1, v))
    setVolumeState(nextVolume)
    if (audio)
      audio.volume = nextVolume
    try {
      localStorage.setItem('music-volume', JSON.stringify(nextVolume))
    }
    catch { }
  }, [])

  const adjustVolume = useCallback((delta: number) => {
    setVolumeState((prev) => {
      const nextVolume = Math.max(0, Math.min(1, prev + delta))
      if (audioRef.current)
        audioRef.current.volume = nextVolume
      try {
        localStorage.setItem('music-volume', JSON.stringify(nextVolume))
      }
      catch { }
      return nextVolume
    })
  }, [])

  const toggleMuted = useCallback(() => {
    setIsMuted((prev) => {
      const nextMuted = !prev
      if (audioRef.current)
        audioRef.current.muted = nextMuted
      try {
        localStorage.setItem('music-muted', JSON.stringify(nextMuted))
      }
      catch { }
      return nextMuted
    })
  }, [])

  const setPlayMode = useCallback((mode: PlayMode) => {
    setPlayModeState(mode)
    writeStored(STORAGE_KEY_PLAY_MODE, mode)
  }, [])

  const setShowTranslation = useCallback((show: boolean) => {
    setShowTranslationState(show)
    writeStored(STORAGE_KEY_SHOW_TRANSLATION, show)
  }, [])

  const setShowLyricEffects = useCallback((show: boolean) => {
    setShowLyricEffectsState(show)
    writeStored(STORAGE_KEY_SHOW_LYRIC_EFFECTS, show)
  }, [])

  const setShowLyricMoments = useCallback((show: boolean) => {
    setShowLyricMomentsState(show)
    writeStored(STORAGE_KEY_SHOW_LYRIC_MOMENTS, show)
  }, [])

  const setHdr = useCallback((enabled: boolean) => {
    setHdrState(enabled)
    writeStored(STORAGE_KEY_HDR, enabled)
  }, [])

  const setShowRomaji = useCallback((show: boolean) => {
    setShowRomajiState(show)
    writeStored(STORAGE_KEY_SHOW_ROMAJI, show)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.mediaSession)
      return
    const ms = navigator.mediaSession
    const audio = audioRef.current
    if (!audio)
      return

    try {
      ms.setActionHandler('play', () => play())
      ms.setActionHandler('pause', () => pause())
      ms.setActionHandler('previoustrack', () => mediaSessionStep(-1))
      ms.setActionHandler('nexttrack', () => mediaSessionStep(1))
      ms.setActionHandler('seekto', (details) => {
        if (!audio || typeof details?.seekTime !== 'number')
          return
        seekedNearEndRef.current = true
        if (details.fastSeek && typeof audio.fastSeek === 'function') {
          try {
            audio.fastSeek(details.seekTime)
          }
          catch {
            audio.currentTime = details.seekTime
          }
        }
        else {
          audio.currentTime = details.seekTime
        }
      })
    }
    catch {
    }

    const onTimeUpdate = () => {
      try {
        if ('setPositionState' in ms && audio && Number.isFinite(audio.duration) && audio.duration > 0) {
          ms.setPositionState({
            duration: audio.duration,
            position: audio.currentTime,
            playbackRate: audio.playbackRate ?? 1,
          })
        }
      }
      catch { }
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      try {
        ms.setActionHandler('play', null)
        ms.setActionHandler('pause', null)
        ms.setActionHandler('previoustrack', null)
        ms.setActionHandler('nexttrack', null)
        ms.setActionHandler('seekto', null)
      }
      catch { }
    }
  }, [mediaSessionStep, pause, play])

  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.mediaSession)
      return
    const ms = navigator.mediaSession
    let lastLyric: string | null | undefined
    let lastAt = 0
    let timer: number | undefined
    const apply = () => {
      timer = undefined
      const index = lyricCursor.getSnapshot()
      const lyric = index == null || !lyricLines[index] ? null : getLyricLineText(lyricLines[index]).trim()
      if (lyric === lastLyric)
        return
      lastLyric = lyric
      lastAt = performance.now()
      updateMediaSessionMetadata(ms, currentTrack, lyric, isPlaying)
    }
    const schedule = () => {
      if (timer != null)
        return
      const wait = MEDIA_SESSION_MIN_INTERVAL_MS - (performance.now() - lastAt)
      if (wait <= 0)
        apply()
      else
        timer = window.setTimeout(apply, wait)
    }
    apply()
    const unsubscribe = lyricCursor.subscribe(schedule)
    return () => {
      unsubscribe()
      if (timer != null)
        window.clearTimeout(timer)
    }
  }, [currentTrack, isPlaying, lyricCursor, lyricLines])

  const hasTranslationLyric = useMemo(() => lyrics.lines.some(line => line.translation), [lyrics])
  const hasRomajiLyric = useMemo(() => lyrics.lines.some(line => line.romanization), [lyrics])

  const actionsValue = useMemo<MusicActionsValue>(() => ({
    getAudio,
    replacePlaylist,
    updatePlaylist,
    markPlaylistFailed,
    deferPlaylist,
    ensurePlaylist,
    playTrack,
    playSong,
    play,
    pause,
    togglePlay,
    next,
    prev,
    setPlayMode,
    seek,
    setVolume,
    adjustVolume,
    toggleMuted,
    setShowTranslation,
    setShowRomaji,
    setShowLyricEffects,
    setShowLyricMoments,
    setHdr,
    refreshLyrics,
  }), [
    getAudio,
    replacePlaylist,
    updatePlaylist,
    markPlaylistFailed,
    deferPlaylist,
    ensurePlaylist,
    playTrack,
    playSong,
    play,
    pause,
    togglePlay,
    next,
    prev,
    setPlayMode,
    seek,
    setVolume,
    adjustVolume,
    toggleMuted,
    setShowTranslation,
    setShowRomaji,
    setShowLyricEffects,
    setShowLyricMoments,
    setHdr,
    refreshLyrics,
  ])

  const playbackValue = useMemo<MusicPlaybackValue>(() => ({
    playlist,
    currentIndex,
    currentTrack,
    isPlaying,
    playMode,
    duration,
    playlistComplete,
    playlistLoading,
    pendingStep,
    playlistState,
  }), [
    playlist,
    currentIndex,
    currentTrack,
    isPlaying,
    playMode,
    duration,
    playlistComplete,
    playlistLoading,
    pendingStep,
    playlistState,
  ])

  const volumeValue = useMemo<MusicVolumeValue>(() => ({
    volume,
    isMuted,
    setVolume,
    adjustVolume,
    toggleMuted,
  }), [volume, isMuted, setVolume, adjustVolume, toggleMuted])

  const preferencesValue = useMemo<MusicPreferencesValue>(() => ({
    showTranslation,
    showRomaji,
    showLyricEffects,
    showLyricMoments,
    hdr,
    setShowTranslation,
    setShowRomaji,
    setShowLyricEffects,
    setShowLyricMoments,
    setHdr,
  }), [
    showTranslation,
    showRomaji,
    showLyricEffects,
    showLyricMoments,
    hdr,
    setShowTranslation,
    setShowRomaji,
    setShowLyricEffects,
    setShowLyricMoments,
    setHdr,
  ])

  const lyricsValue = useMemo<MusicLyricsValue>(() => ({
    lyricCursor,
    lyricLines,
    lyricStatus,
    lyrics,
    lyricCandidates,
    lyricKind,
    lyricSiteKind,
    lyricIsSiteVersion,
    lyricSourcesPending: lyricsPending,
    refreshLyrics,
    lyricAnnotated,
    lyricAnnotationsGenerating,
    hasTranslationLyric,
    hasRomajiLyric,
  }), [
    lyricCursor,
    lyricLines,
    lyricStatus,
    lyrics,
    lyricCandidates,
    lyricKind,
    lyricSiteKind,
    lyricIsSiteVersion,
    lyricsPending,
    refreshLyrics,
    lyricAnnotated,
    lyricAnnotationsGenerating,
    hasTranslationLyric,
    hasRomajiLyric,
  ])

  const combinedValue = useMemo<MusicContextValue>(() => ({
    ...playbackValue,
    ...volumeValue,
    ...preferencesValue,
    ...lyricsValue,
    ...actionsValue,
  }), [playbackValue, volumeValue, preferencesValue, lyricsValue, actionsValue])

  return (
    <MusicClockContext value={clock}>
      <MusicActionsContext value={actionsValue}>
        <MusicPlaybackContext value={playbackValue}>
          <MusicVolumeContext value={volumeValue}>
            <MusicPreferencesContext value={preferencesValue}>
              <MusicLyricsContext value={lyricsValue}>
                <MusicContext value={combinedValue}>{children}</MusicContext>
              </MusicLyricsContext>
            </MusicPreferencesContext>
          </MusicVolumeContext>
        </MusicPlaybackContext>
      </MusicActionsContext>
    </MusicClockContext>
  )
}
