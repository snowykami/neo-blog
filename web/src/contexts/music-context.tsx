'use client'
import type { LyricCandidate, LyricSourceKind } from '@/lib/lyrics/resolve'
import type { LyricTrackInfo } from '@/lib/lyrics/strip-credits'
import type { ResolvedLyrics } from '@/lib/lyrics/types'
import type { MusicTrack } from '@/models/music'
import type { MusicLyricLine } from '@/utils/music-lyric'
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
import { applyEmphasis } from '@/lib/lyrics/emphasis'
import { toSingleLineLyrics } from '@/lib/lyrics/from-platform'
import { LYRIC_SOURCE_KINDS } from '@/lib/lyrics/resolve'
import { getCurrentLyricIndex, LYRIC_PLACEHOLDERS } from '@/utils/music-lyric'
import { requestLyricAnnotations, useLyricAnnotations } from './lyric-annotations'
import { useResolvedSongLyrics } from './song-lyrics'

export type PlayMode = 'repeat-all' | 'repeat-one' | 'shuffle'

/**
 * 播放状态与操作。value 经过 memo，只包含低频变化的状态：
 * 播放进度不在这里（见 useMusicClock），当前歌词行只在换行时变化
 */
interface MusicContextValue {
  // 播放状态
  playlist: MusicTrack[]
  currentIndex: number | null
  currentTrack: MusicTrack | null
  isPlaying: boolean
  playMode: PlayMode
  duration: number | null
  bufferedPercent: number
  volume: number
  isMuted: boolean
  // 当前歌词行（随播放进度换行时更新），为 lyricLines 中的下标
  // 当前歌词行（lyricLines 中的下标）的外部 store：只在换行时通知，订阅见 useCurrentLyricIndex / useCurrentLyric，
  // 不放进 context value，换行不会让所有使用 useMusic 的组件重渲染
  lyricCursor: LyricCursor
  // 最终显示歌词的主唱行（单行歌词组件使用的旧结构，见 toSingleLineLyrics）：导航栏、单曲卡与媒体会话使用
  lyricLines: MusicLyricLine[]
  // 当前曲目歌词的加载状态：loading 请求中；ready 有歌词；none 没有歌词或获取失败
  lyricStatus: 'loading' | 'ready' | 'none'
  // 歌词引擎使用的数据模型（已预处理，见 lib/lyrics），按来源等级与读者固定的来源选出
  lyrics: ResolvedLyrics
  // 当前曲目已到达且有歌词的各来源（等级从高到低），当前显示的来源，以及读者为这首歌固定的来源
  lyricCandidates: LyricCandidate[]
  lyricKind: LyricSourceKind | null
  lyricPin: LyricSourceKind | null
  setLyricPin: (pin: LyricSourceKind | null) => void
  // 读者为某首歌固定的歌词来源（文章内的歌词摘录等按歌曲 id 取歌词时使用）
  getLyricPin: (id: number) => LyricSourceKind | null
  // 仍有来源在请求中（已显示的歌词可能被更高等级的来源替换）
  lyricSourcesPending: boolean
  // 当前显示的歌词叠加了 AI 歌词标注（强调词句、上色、情绪等）
  lyricAnnotated: boolean
  // 翻译与音译是两个独立开关，可同时开启
  showTranslation: boolean
  showRomaji: boolean
  // 歌词强调特效（放大、辉光、波浪）开关，播放器页与悬浮播放器共用
  showLyricEffects: boolean
  setShowLyricEffects: (show: boolean) => void
  setShowTranslation: (show: boolean) => void
  setShowRomaji: (show: boolean) => void
  hasTranslationLyric: boolean
  hasRomajiLyric: boolean
  getAudio: () => HTMLAudioElement | null

  // 播放列表 操作
  // startTime：起始曲目的初始播放进度（秒），用于刷新后恢复进度，会在该曲目元数据就绪后应用
  replacePlaylist: (tracks: MusicTrack[], startIndex?: number, startTime?: number) => void

  // 播放控制
  // startTime：可选的起始播放进度（秒），用于从歌词摘录等位置开始播放
  playTrack: (index: number, startTime?: number) => void // 指定播放曲目
  play: () => void // 播放
  pause: () => void // 暂停
  togglePlay: () => void // 切换播放/暂停
  next: () => void // 下一首
  prev: () => void // 上一首
  setPlayMode: (m: PlayMode) => void // 设置播放模式（同时保存到本地）

  // 可选：音量/进度控制
  seek: (seconds: number) => void // 跳转到指定秒数
  setVolume: (v: number) => void // 设置音量 0~1
  toggleMuted: () => void // 切换静音

  // sample track 样品曲目，用于在未获取到时fallback
  sampleTrack: MusicTrack
}

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

const SAMPLE_TRACK: MusicTrack = {
  id: 0,
  name: 'Sample Track',
  artists: ['Sample Artist'],
  album: 'Sample Album',
  albumPic: 'https://via.placeholder.com/150',
  audio: '',
  lyric: '',
  link: '',
  aliases: [],
}

export const PLAY_MODES: PlayMode[] = ['repeat-all', 'repeat-one', 'shuffle']

/** 播放模式按 列表循环 → 单曲循环 → 随机 依次切换 */
export function getNextPlayMode(mode: PlayMode): PlayMode {
  return PLAY_MODES[(PLAY_MODES.indexOf(mode) + 1) % PLAY_MODES.length]
}

// MediaSession 标题（当前歌词）的最短更新间隔
const MEDIA_SESSION_MIN_INTERVAL_MS = 1000

const STORAGE_KEY_PLAY_MODE = 'music-play-mode'
// 读者按曲目固定的歌词来源：{ 曲目 id: 来源 }，最多保留 2000 首（参考 StarryPlayer），超出时淘汰最早固定的
const STORAGE_KEY_LYRIC_PINS = 'music-lyric-pins'
const MAX_LYRIC_PINS = 2000
const STORAGE_KEY_SHOW_TRANSLATION = 'music-show-translation'
const STORAGE_KEY_SHOW_ROMAJI = 'music-show-romaji'
const STORAGE_KEY_SHOW_LYRIC_EFFECTS = 'music-show-lyric-effects'
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

export function useMusic(): MusicContextValue {
  const ctx = useContext(MusicContext)
  if (!ctx)
    throw new Error('useMusic must be used within MusicProvider')
  return ctx
}

/** 播放时钟本身：需要在回调中读取进度（如定期保存进度）而不想因此重渲染时使用 */
/**
 * 按歌曲 id 取最终显示的歌词（与播放器、导航栏同一套来源与选择规则，并遵循读者为这首歌固定的来源）；
 * id 为空时不请求。track 用于去掉「歌名 - 歌手」等署名行
 */
export function useSongLyrics(id: number | null, track?: LyricTrackInfo | null) {
  const { getLyricPin } = useMusic()
  return useResolvedSongLyrics(id, id == null ? null : getLyricPin(id), track)
}

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
  const { lyricCursor } = useMusic()
  return useSyncExternalStore(
    enabled ? lyricCursor.subscribe : noopSubscribe,
    enabled ? lyricCursor.getSnapshot : nullSnapshot,
    nullSnapshot,
  )
}

/** 当前歌词行的文字；enabled 为 false 时不订阅（始终为 null） */
export function useCurrentLyric(enabled = true): string | null {
  const { lyricLines } = useMusic()
  const index = useCurrentLyricIndex(enabled)
  return index == null ? null : lyricLines[index]?.originalText ?? null
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
    // 某些环境可能不支持构造函数
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
  const [bufferedPercent, setBufferedPercent] = useState<number>(0)
  const [volume, setVolumeState] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  // 原始歌词响应，与所属曲目 id 绑定；只有 trackId 与当前曲目一致时才会被使用
  // 各歌词来源的原始结果，与所属曲目 id 绑定：undefined 为请求中，null 为没有或失败
  const [lyricPins, setLyricPins] = useState<Record<string, LyricSourceKind>>({})
  const [showTranslation, setShowTranslationState] = useState(true)
  const [showRomaji, setShowRomajiState] = useState(false)
  const [showLyricEffects, setShowLyricEffectsState] = useState(true)
  const currentTrack = currentIndex != null ? playlist[currentIndex] ?? null : null
  const currentTrackId = currentTrack?.id ?? null
  const getAudio = useCallback(() => audioRef.current, [])

  // 供事件回调读取最新值，避免闭包拿到过期的 playlist / index / mode
  const playlistRef = useRef(playlist)
  const currentIndexRef = useRef(currentIndex)
  const playModeRef = useRef(playMode)
  useEffect(() => {
    playlistRef.current = playlist
    currentIndexRef.current = currentIndex
    playModeRef.current = playMode
  }, [playlist, currentIndex, playMode])

  useEffect(() => {
    if (typeof window === 'undefined')
      return

    try {
      const storedVolume = localStorage.getItem('music-volume')
      if (storedVolume != null) {
        const nextVolume = Math.max(0, Math.min(1, Number(JSON.parse(storedVolume))))
        if (Number.isFinite(nextVolume)) {
          setVolumeState(nextVolume)
          if (audioRef.current)
            audioRef.current.volume = nextVolume
        }
      }

      const storedMuted = localStorage.getItem('music-muted')
      if (storedMuted != null) {
        const nextMuted = Boolean(JSON.parse(storedMuted))
        setIsMuted(nextMuted)
        if (audioRef.current)
          audioRef.current.muted = nextMuted
      }

      const storedPlayMode = JSON.parse(localStorage.getItem(STORAGE_KEY_PLAY_MODE) ?? 'null')
      if (PLAY_MODES.includes(storedPlayMode))
        setPlayModeState(storedPlayMode)

      const storedPins = JSON.parse(localStorage.getItem(STORAGE_KEY_LYRIC_PINS) ?? 'null')
      if (storedPins && typeof storedPins === 'object')
        setLyricPins(Object.fromEntries(Object.entries(storedPins).filter(([, value]) => LYRIC_SOURCE_KINDS.includes(value as LyricSourceKind))) as Record<string, LyricSourceKind>)

      const storedEffects = readStoredBoolean(STORAGE_KEY_SHOW_LYRIC_EFFECTS)
      if (storedEffects != null)
        setShowLyricEffectsState(storedEffects)

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

  // 创建 audio 元素并做基础配置（仅在客户端）
  useEffect(() => {
    if (typeof window === 'undefined')
      return
    if (!audioRef.current) {
      const audio = new Audio()
      audio.preload = 'metadata'
      audio.volume = volume
      audio.muted = isMuted
      audioRef.current = audio
    }
  }, [isMuted, volume])

  useEffect(() => {
    if (!audioRef.current)
      return
    audioRef.current.volume = volume
    audioRef.current.muted = isMuted
  }, [isMuted, volume])

  // 仅在曲目 id 变化时切换 audio.src，并在 pendingPlay 时尝试播放
  useEffect(() => {
    const audio = audioRef.current
    if (!audio)
      return
    if (currentTrackId == null) {
      if (prevTrackIdRef.current != null) {
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
    // 切换曲目时重置时长与进度，避免进度条短暂沿用上一首的时长
    setDuration(null)
    clock.set(0)
    setBufferedPercent(0)
    audio.src = track?.audio || ''
    audio.currentTime = 0
    if (pendingPlayRef.current) {
      pendingPlayRef.current = false
      void audio.play().catch(() => {
        /* play 可能被浏览器阻止（自动播放策略），事件监听会同步状态 */
      })
    }
  }, [clock, currentTrackId])

  // 切换到指定索引；目标与当前曲目相同时（如单曲歌单）直接从头播放，避免 effect 不触发导致停播
  // startTime 为可选的起始进度（秒），在不切歌时立即跳转，切歌时等元数据就绪后再跳转
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
      if (audio) {
        if (pendingSeek) {
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
    // 立即同步 ref，保证连续切歌时基于最新索引计算
    currentIndexRef.current = index
    setCurrentIndex(index)
  }, [clock])

  // 统一通过 audio 事件驱动上下文状态（isPlaying / time / duration / buffered）
  useEffect(() => {
    const audio = audioRef.current
    if (!audio)
      return

    const onPlay = () => {
      setIsPlaying(true)
    }
    const onPause = () => {
      setIsPlaying(false)
    }

    const updateBuffered = () => {
      try {
        if (audio.buffered.length > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
          const end = audio.buffered.end(audio.buffered.length - 1)
          setBufferedPercent(Math.min(1, end / audio.duration))
        }
        else {
          setBufferedPercent(0)
        }
      }
      catch {
        setBufferedPercent(0)
      }
    }

    const onLoaded = () => {
      const pendingSeek = pendingSeekRef.current
      if (pendingSeek && pendingSeek.trackId === prevTrackIdRef.current && Number.isFinite(audio.duration) && audio.duration > 0) {
        pendingSeekRef.current = null
        try {
          audio.currentTime = Math.max(0, Math.min(pendingSeek.time, audio.duration))
        }
        catch { }
      }
      setDuration(Number.isFinite(audio.duration) ? audio.duration : null)
      clock.set(audio.currentTime ?? 0)
      updateBuffered()
    }
    // timeupdate 本身约每秒 4 次；跳转完成时立即同步一次
    const onTimeUpdate = () => clock.set(audio.currentTime)
    const onEnded = () => {
      if (playModeRef.current === 'repeat-one') {
        audio.currentTime = 0
        void audio.play().catch(() => { })
        return
      }
      goTo(getAdjacentIndex(playlistRef.current, currentIndexRef.current, playModeRef.current, 1), true)
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('seeked', onTimeUpdate)
    audio.addEventListener('progress', updateBuffered)
    audio.addEventListener('ended', onEnded)

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('seeked', onTimeUpdate)
      audio.removeEventListener('progress', updateBuffered)
      audio.removeEventListener('ended', onEnded)
    }
  }, [clock, goTo])

  // 当前曲目的歌词：与文章内的单曲卡、歌词摘录共用同一份来源与选择结果（见 contexts/song-lyrics.ts）；
  // 去掉署名行时用曲目信息判断「歌名 - 歌手」行
  const lyricPin = currentTrackId != null ? lyricPins[currentTrackId] ?? null : null
  const songLyrics = useResolvedSongLyrics(currentTrackId, lyricPin, currentTrack)
  // 强调特效：按演唱时长规则计算，并叠加歌词标注（逐字歌词）。标注在读者播放到这首歌时才请求（懒处理），
  // 关闭歌词特效或不是逐字歌词时不请求
  const wantsAnnotations = isPlaying && showLyricEffects && songLyrics.lyrics.wordTimed && currentTrackId != null && currentTrackId > 0
  useEffect(() => {
    if (wantsAnnotations && currentTrackId != null)
      requestLyricAnnotations(currentTrackId)
  }, [currentTrackId, wantsAnnotations])
  const annotations = useLyricAnnotations(currentTrackId)
  const lyrics = useMemo(() => applyEmphasis(songLyrics.lyrics, annotations), [annotations, songLyrics.lyrics])
  const lyricAnnotated = showLyricEffects && songLyrics.lyrics.wordTimed && (annotations?.lines.length ?? 0) > 0
  const lyricCandidates = songLyrics.candidates
  const lyricKind = songLyrics.kind
  const lyricsPending = songLyrics.pending
  const lyricStatus = songLyrics.status

  // 当前歌词行：订阅播放时钟，只在换行时更新状态（相同的值不会触发重渲染）
  const lyricLines = useMemo(() => toSingleLineLyrics(lyrics).lines, [lyrics])
  useEffect(() => {
    const update = () => lyricCursor.set(lyricLines.length === 0
      ? null
      : getCurrentLyricIndex(lyricLines, clock.getSnapshot() * 1000, null))
    update()
    return clock.subscribe(update)
  }, [clock, lyricCursor, lyricLines])

  // 操作函数 —— 不直接 set isPlaying/currentTime（由事件回路同步）
  const replacePlaylist = useCallback((tracks: MusicTrack[], startIndex = 0, startTime?: number) => {
    const index = tracks.length > 0 ? Math.max(0, Math.min(startIndex, tracks.length - 1)) : null
    const track = index == null ? null : tracks[index]
    pendingSeekRef.current = track && startTime != null && Number.isFinite(startTime) && startTime > 0
      ? { trackId: track.id, time: startTime }
      : null
    // 新歌单的起始曲目与正在加载的曲目相同时，src 不会重新加载，若元数据已就绪需立即应用进度
    const audio = audioRef.current
    if (audio && pendingSeekRef.current && pendingSeekRef.current.trackId === prevTrackIdRef.current && audio.readyState >= 1) {
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
  }, [])

  const playTrack = useCallback((index: number, startTime?: number) => {
    if (index < 0 || index >= playlistRef.current.length)
      return
    // 指定了起始进度时（如歌词摘录）总是从该位置播放
    if (startTime != null) {
      goTo(index, true, startTime)
      return
    }
    // 点击正在播放的曲目时仅继续播放，不从头开始
    if (index === currentIndexRef.current) {
      void audioRef.current?.play().catch(() => { })
      return
    }
    goTo(index, true)
  }, [goTo])

  const play = useCallback(() => {
    const audio = audioRef.current
    if (!audio)
      return
    void audio.play().catch(() => {
      /* 失败或被阻止，事件处理会同步状态 */
    })
  }, [])

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
    if (audio.paused) {
      void audio.play().catch(() => { })
    }
    else {
      audio.pause()
    }
  }, [])

  const next = useCallback(() => {
    goTo(getAdjacentIndex(playlistRef.current, currentIndexRef.current, playModeRef.current, 1), true)
  }, [goTo])

  const prev = useCallback(() => {
    goTo(getAdjacentIndex(playlistRef.current, currentIndexRef.current, playModeRef.current, -1), true)
  }, [goTo])

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio)
      return
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

  const setLyricPin = useCallback((pin: LyricSourceKind | null) => {
    if (currentTrackId == null)
      return
    const key = String(currentTrackId)
    setLyricPins((prev) => {
      const next = { ...prev }
      delete next[key]
      if (pin)
        next[key] = pin
      // 超出上限时淘汰最早固定的（对象按插入顺序遍历）
      const keys = Object.keys(next)
      for (const old of keys.slice(0, Math.max(0, keys.length - MAX_LYRIC_PINS)))
        delete next[old]
      writeStored(STORAGE_KEY_LYRIC_PINS, next)
      return next
    })
  }, [currentTrackId])

  const getLyricPin = useCallback((id: number) => lyricPins[id] ?? null, [lyricPins])

  const setShowTranslation = useCallback((show: boolean) => {
    setShowTranslationState(show)
    writeStored(STORAGE_KEY_SHOW_TRANSLATION, show)
  }, [])

  const setShowLyricEffects = useCallback((show: boolean) => {
    setShowLyricEffectsState(show)
    writeStored(STORAGE_KEY_SHOW_LYRIC_EFFECTS, show)
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
      ms.setActionHandler('previoustrack', () => prev())
      ms.setActionHandler('nexttrack', () => next())
      ms.setActionHandler('seekto', (details) => {
        if (!audio || typeof details?.seekTime !== 'number')
          return
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
      // 某些浏览器/环境对 setActionHandler 有限制
    }

    // 同步 position state
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
    // 事件回调只依赖稳定的播放控制方法，元数据交给下方 effect 按曲目/歌词/播放状态更新
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
  }, [pause, play, next, prev])

  // 有歌词且正在播放时，把 MediaSession 的标题更新为当前歌词，暂停后回退到曲目名。
  // 直接订阅当前行（不经过 React 渲染）；重建 MediaMetadata（含封面）开销不小，快歌换行频繁时最多每秒更新一次
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
      const lyric = index == null ? null : lyricLines[index]?.originalText ?? null
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

  // 按最终显示的歌词判断（TTML、QQ 音乐的翻译与音译也算）
  const hasTranslationLyric = useMemo(() => lyrics.lines.some(line => line.translation), [lyrics])
  const hasRomajiLyric = useMemo(() => lyrics.lines.some(line => line.romanization), [lyrics])
  const value = useMemo<MusicContextValue>(() => ({
    playlist,
    currentIndex,
    currentTrack,
    isPlaying,
    playMode,
    duration,
    bufferedPercent,
    volume,
    isMuted,
    lyricCursor,
    lyricLines,
    lyricStatus,
    lyrics,
    lyricCandidates,
    lyricKind,
    lyricPin,
    setLyricPin,
    getLyricPin,
    lyricSourcesPending: lyricsPending,
    lyricAnnotated,
    showTranslation,
    showRomaji,
    setShowTranslation,
    setShowRomaji,
    showLyricEffects,
    setShowLyricEffects,
    hasTranslationLyric,
    hasRomajiLyric,
    getAudio,
    replacePlaylist,
    playTrack,
    play,
    pause,
    togglePlay,
    next,
    prev,
    setPlayMode,
    seek,
    setVolume,
    toggleMuted,
    sampleTrack: SAMPLE_TRACK,
  }), [
    playlist,
    currentIndex,
    currentTrack,
    isPlaying,
    playMode,
    duration,
    bufferedPercent,
    volume,
    isMuted,
    lyricCursor,
    lyricLines,
    lyricStatus,
    lyrics,
    lyricCandidates,
    lyricKind,
    lyricPin,
    setLyricPin,
    getLyricPin,
    lyricsPending,
    lyricAnnotated,
    showTranslation,
    showRomaji,
    setShowTranslation,
    setShowRomaji,
    showLyricEffects,
    setShowLyricEffects,
    hasTranslationLyric,
    hasRomajiLyric,
    getAudio,
    replacePlaylist,
    playTrack,
    play,
    pause,
    togglePlay,
    next,
    prev,
    setPlayMode,
    seek,
    setVolume,
    toggleMuted,
  ])

  return (
    <MusicClockContext value={clock}>
      <MusicContext value={value}>{children}</MusicContext>
    </MusicClockContext>
  )
}
