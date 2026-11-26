import type { MusicLyricsState } from './music-lyrics-engine-state'
import type { MusicLyricTranslationLangStatus } from '@/api/music'
import type { LyricTranslationSelection } from '@/lib/lyrics/lyric-language'
import type { LyricCandidate, LyricSourceKind } from '@/lib/lyrics/resolve'
import type { LyricTargetLang } from '@/lib/lyrics/target-lang'
import type { LyricLine, ResolvedLyrics } from '@/lib/lyrics/types'
import type { MusicTrack } from '@/models/music'

export type PlayMode = 'repeat-all' | 'repeat-one' | 'shuffle'

export const PLAY_MODES: PlayMode[] = ['repeat-all', 'repeat-one', 'shuffle']

/** 播放模式按 列表循环 → 单曲循环 → 随机 依次切换 */
export function getNextPlayMode(mode: PlayMode): PlayMode {
  return PLAY_MODES[(PLAY_MODES.indexOf(mode) + 1) % PLAY_MODES.length]
}

// 自动切歌熔断阈值（见 spec 5.2）：单首至少实际出声播放满 MIN_VALID_PLAY_MS 才算正常播放；
// 未主动定位到曲末而连续异常 ended 达 MAX_ABNORMAL_AUTO_SKIPS 次，或系统媒体控制未出声连续快速切歌达 MAX_MEDIA_SESSION_STORM_SKIPS 次时停播熔断
export const MIN_VALID_PLAY_MS = 2000
export const MAX_ABNORMAL_AUTO_SKIPS = 3
export const NEAR_END_SEEK_THRESHOLD_S = 5
export const MEDIA_SESSION_STORM_WINDOW_MS = 1500
export const MAX_MEDIA_SESSION_STORM_SKIPS = 5

// 播放地址在后端缓存 10 分钟：预取过的歌曲超过这个时间再经过时重新预取
export const PREFETCH_TTL_MS = 10 * 60 * 1000

// 本地持久化键：用于判断是否存在可恢复的断点续播会话
export const STORAGE_KEY_INDEX = 'music-current-index'
export const STORAGE_KEY_TRACK_ID = 'music-current-track-id'
export const STORAGE_KEY_TIME = 'music-current-time'
const STORAGE_KEY_PLAY_MODE = 'music-play-mode'
const DESKTOP_ISLAND_PAIRED_KEY = 'neo-blog:desktop-island-paired'

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
  setTranslationLang: (lang: LyricTargetLang | null, preferNative?: boolean) => void
  setTranslationSelections: (selections: LyricTranslationSelection[]) => void
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
  /** 本次浏览器会话内是否已经实际开始播放过（跨路由组与 [locale] 软跳转保留） */
  hasPlayed: boolean
  playMode: PlayMode
  duration: number | null
  playlistComplete: boolean
  playlistLoading: boolean
  pendingStep: 1 | -1 | null
  playlistState: 'pending' | 'loaded' | 'failed'
  adjacentTracks: { prev: MusicTrack | null, next: MusicTrack | null }
}

/** 音量状态与控制（拖动滑块时高频更新，仅音量控件订阅） */
export interface MusicVolumeValue {
  volume: number
  isMuted: boolean
  setVolume: (v: number) => void
  adjustVolume: (delta: number) => void
  toggleMuted: () => void
}

/** 界面显示偏好开关（翻译、音译、强调特效、热评时刻、HDR 高光、手动覆盖/双项对比翻译语言及原生/AI 译文偏好） */
export interface MusicPreferencesValue {
  showTranslation: boolean
  translationLang: LyricTargetLang | null
  preferNativeTranslation: boolean
  translationSelections: LyricTranslationSelection[]
  showRomaji: boolean
  showLyricEffects: boolean
  showLyricMoments: boolean
  hdr: boolean
  setShowTranslation: (show: boolean) => void
  setTranslationLang: (lang: LyricTargetLang | null, preferNative?: boolean) => void
  setTranslationSelections: (selections: LyricTranslationSelection[]) => void
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
  canToggleTranslation: boolean
  lyricAiTranslated: boolean
  lyricTranslationsGenerating: boolean
  effectiveTranslationLang: LyricTargetLang
  songLang: string | null
  availableTranslationLangs: MusicLyricTranslationLangStatus[]
  hasRomajiLyric: boolean
  canToggleRomaji: boolean
  lyricAiRomanized: boolean
  lyricPronunciationsGenerating: boolean
}

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

export interface ValueStore<T> {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => T
  set: (next: T) => void
}

/** 只在值变化时通知订阅者的外部 store（播放时钟与当前歌词行） */
export function createValueStore<T>(initial: T): ValueStore<T> {
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

export function createMusicClock(): ValueStore<number> {
  return createValueStore(0)
}

export function createLyricCursor(): ValueStore<number | null> {
  return createValueStore<number | null>(null)
}

/** 是否需要预取这首歌的播放地址：没预取过，或上次预取已超过后端缓存的有效期 */
export function shouldPrefetch(prefetched: Map<number, number>, id: number, now: number): boolean {
  const at = prefetched.get(id)
  if (at != null && now - at < PREFETCH_TTL_MS)
    return false
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
export function rebasePlaylist(
  tracks: MusicTrack[],
  current: MusicTrack | null,
  currentIndex: number | null,
): { tracks: MusicTrack[], index: number | null } {
  if (!current)
    return { tracks, index: tracks.length > 0 ? 0 : null }
  const index = tracks.findIndex(track => track.id === current.id)
  if (index >= 0)
    return { tracks, index }
  const insertAt = Math.max(0, Math.min(currentIndex ?? 0, tracks.length))
  return { tracks: [...tracks.slice(0, insertAt), current, ...tracks.slice(insertAt)], index: insertAt }
}

/** 轻量级单行原文提取（供壳层 useCurrentLyric 使用，避免根布局静态引入整套歌词解析工具） */
export function extractLyricLinePlainText(line: LyricLine): string {
  return line.words.map(word => word.text).join('').trim()
}

export type QueuedRuntimeCommand
  = | { type: 'next' }
    | { type: 'prev' }
    | { type: 'ensurePlaylist', resolve: (ok: boolean) => void }
    | { type: 'setShowTranslation', show: boolean }
    | { type: 'setTranslationLang', lang: LyricTargetLang | null, preferNative?: boolean }
    | { type: 'setTranslationSelections', selections: LyricTranslationSelection[] }
    | { type: 'setShowRomaji', show: boolean }
    | { type: 'setShowLyricEffects', show: boolean }
    | { type: 'setShowLyricMoments', show: boolean }
    | { type: 'setHdr', enabled: boolean }
    | { type: 'refreshLyrics' }

export interface MusicRuntimeSnapshot {
  playback: MusicPlaybackValue
  volume: Pick<MusicVolumeValue, 'volume' | 'isMuted'>
  preferences: Omit<
    MusicPreferencesValue,
    | 'setShowTranslation'
    | 'setTranslationLang'
    | 'setTranslationSelections'
    | 'setShowRomaji'
    | 'setShowLyricEffects'
    | 'setShowLyricMoments'
    | 'setHdr'
  >
  lyricsState: MusicLyricsState
  lyricLines: LyricLine[]
  hasTranslationLyric: boolean
  canToggleTranslation: boolean
  hasRomajiLyric: boolean
  canToggleRomaji: boolean
}

// 浏览器会话级单例状态：根布局位于 app/[locale]/layout.tsx，前后台软路由若因语言偏好与地址前缀不一致触发 [locale] 段切换，
// MusicProvider 会被卸载重建而 window 不刷新。将底层 Audio 与播放会话放在模块级复用，保证重挂载无缝接管同一音轨、不产生孤儿双播
export const audioRef: { current: HTMLAudioElement | null } = { current: null }
export const pendingPlayRef = { current: false }
export const pendingSeekRef: { current: { trackId: number, time: number } | null } = { current: null }
export const prevTrackIdRef: { current: number | null } = { current: null }
export const playlistRef: { current: MusicTrack[] } = { current: [] }
export const currentIndexRef: { current: number | null } = { current: null }
export const playModeRef: { current: PlayMode } = { current: 'repeat-all' }
export const playlistStateRef: { current: 'pending' | 'loaded' | 'failed' } = { current: 'pending' }
export const playlistCompleteRef = { current: true }
export const deferredPlaylistRef: { current: (() => Promise<MusicTrack[]>) | null } = { current: null }
export const playlistLoadingRef: { current: Promise<boolean> | null } = { current: null }
export const playlistWantedRef = { current: false }
export const playedMsRef = { current: 0 }
export const playingSinceRef: { current: number | null } = { current: null }
export const seekedNearEndRef = { current: false }
export const abnormalEndCountRef = { current: 0 }
export const mediaStormCountRef = { current: 0 }
export const lastMediaSkipAtRef = { current: 0 }
export const circuitTrippedRef = { current: false }
export const hasPlayedRef = { current: false }
export const volumeRef = { current: 1 }
export const isMutedRef = { current: false }
const audioPrefsBootstrappedRef = { current: false }

const activationListeners = new Set<() => void>()
const playlistSyncListeners = new Set<() => void>()

export const sharedSession = {
  /** 是否已在客户端完成过运行时水合：首次水合前保持与 SSR 一致的默认初值，后续软路由重挂载时直接继承活跃会话 */
  hydrated: false,
  /** 是否已激活音乐运行时控制器（MusicRuntimeController） */
  runtimeActivated: false,
  /** 是否允许拉取并同步初始歌单（存在断点会话、点击展开迷你播放器或进入 /music 时置位；仅悬停不拉取歌单） */
  playlistSyncRequested: false,
  clock: createMusicClock(),
  lyricCursor: createLyricCursor(),
  syncActiveProvider: null as (() => void) | null,
  runtimeActions: null as MusicActionsValue | null,
  queuedCommands: [] as QueuedRuntimeCommand[],
}

/** 取消尚未被控制器消费的排队上一首/下一首指令（对齐控制器 supersedeSteps 语义） */
export function clearQueuedStepCommands(): void {
  if (sharedSession.queuedCommands.length === 0)
    return
  sharedSession.queuedCommands = sharedSession.queuedCommands.filter(
    cmd => cmd.type !== 'next' && cmd.type !== 'prev',
  )
}

function bootstrapStoredAudioPreferencesOnce(): void {
  if (audioPrefsBootstrappedRef.current || sharedSession.hydrated || typeof window === 'undefined')
    return
  audioPrefsBootstrappedRef.current = true
  try {
    const storedVolume = window.localStorage.getItem('music-volume')
    if (storedVolume != null) {
      const parsed: unknown = JSON.parse(storedVolume)
      if (typeof parsed === 'number' && Number.isFinite(parsed))
        volumeRef.current = Math.max(0, Math.min(1, parsed))
    }
    const storedMuted = window.localStorage.getItem('music-muted')
    if (storedMuted != null) {
      const parsed: unknown = JSON.parse(storedMuted)
      if (typeof parsed === 'boolean')
        isMutedRef.current = parsed
    }
    const storedMode = window.localStorage.getItem(STORAGE_KEY_PLAY_MODE)
    if (storedMode != null) {
      const parsed: unknown = JSON.parse(storedMode)
      if (typeof parsed === 'string' && PLAY_MODES.includes(parsed as PlayMode))
        playModeRef.current = parsed as PlayMode
    }
  }
  catch { }
}

/** 按需创建并初始化单例 HTMLAudioElement（未开启音乐的静默访问期间保持为 null；首次创建时立即同步本地音量/静音偏好防止爆音） */
export function ensureSingletonAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined')
    return null
  bootstrapStoredAudioPreferencesOnce()
  if (!audioRef.current) {
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.volume = volumeRef.current
    audio.muted = isMutedRef.current
    audioRef.current = audio
  }
  return audioRef.current
}

export function readStoredFiniteNumber(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw == null)
      return null
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
  }
  catch {
    return null
  }
}

function isMacDesktopBrowser(): boolean {
  if (typeof navigator === 'undefined')
    return false
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  if (uaData?.platform)
    return /mac/i.test(uaData.platform)
  return /Macintosh|Mac OS X/i.test(navigator.userAgent) && !/Mobile|iPad|iPhone/i.test(navigator.userAgent)
}

export function isMusicPagePathname(pathname?: string | null): boolean {
  if (!pathname)
    return false
  return pathname === '/music' || /^\/[a-z]{2}(?:-[a-z]{2})?\/music(?:\/|$)/i.test(pathname)
}

/** 是否存在桌面灵动岛配对或接续请求（用于决定是否按需挂载 DesktopIslandBridge） */
export function hasDesktopIslandSession(): boolean {
  if (typeof window === 'undefined')
    return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('island_handoff') === '1')
      return true
  }
  catch { }
  try {
    if (isMacDesktopBrowser() && window.localStorage.getItem(DESKTOP_ISLAND_PAIRED_KEY) === '1')
      return true
  }
  catch { }
  return false
}

/** 本地 localStorage 是否已存有断点曲目记录 */
export function hasStoredPlaybackRecord(): boolean {
  if (typeof window === 'undefined')
    return false
  const trackId = readStoredFiniteNumber(STORAGE_KEY_TRACK_ID)
  if (trackId != null && trackId > 0)
    return true
  const trackIndex = readStoredFiniteNumber(STORAGE_KEY_INDEX)
  return trackIndex != null && trackIndex >= 0
}

/**
 * 检查当前浏览器是否存在需要自动恢复的音乐会话：
 * 1. 本页已实际发起过播放或歌单同步；
 * 2. 当前直接打开了 `/music` 播放器页或携带 `?island_handoff=1` 接续参数；
 * 3. `localStorage` 中存有上次播放的曲目 ID 或歌单索引断点记录；
 * 4. macOS 设备曾与本地原生灵动岛完成配对（支持原生续播反向接管）。
 */
export function hasPersistedMusicSession(): boolean {
  if (typeof window === 'undefined')
    return false
  if (sharedSession.playlistSyncRequested || hasPlayedRef.current)
    return true
  if (isMusicPagePathname(window.location.pathname))
    return true
  if (hasStoredPlaybackRecord())
    return true
  return hasDesktopIslandSession()
}

let runtimeModulePromise: Promise<typeof import('@/contexts/music-runtime-controller')> | null = null

/** 复用同一 Promise 加载 MusicRuntimeController chunk，避免预热与 dynamic() 并发重复解析；下载失败时清空缓存以便重试 */
export function loadMusicRuntimeModule() {
  runtimeModulePromise ??= import('@/contexts/music-runtime-controller').catch((err) => {
    runtimeModulePromise = null
    throw err
  })
  return runtimeModulePromise
}

/** 仅预下载 MusicRuntimeController chunk（不挂载、不发请求），供导航栏/卡片悬停预热使用 */
export function preloadMusicRuntime(): void {
  if (typeof window === 'undefined')
    return
  void loadMusicRuntimeModule().catch(() => {})
}

/** 请求同步初始歌单（幂等） */
export function requestMusicPlaylistSync(): void {
  if (typeof window === 'undefined' || sharedSession.playlistSyncRequested)
    return
  sharedSession.playlistSyncRequested = true
  playlistSyncListeners.forEach(listener => listener())
}

export function isMusicPlaylistSyncRequested(): boolean {
  return sharedSession.playlistSyncRequested
}

export function subscribeMusicPlaylistSync(listener: () => void): () => void {
  playlistSyncListeners.add(listener)
  return () => {
    playlistSyncListeners.delete(listener)
  }
}

/**
 * 激活音乐运行时控制器（幂等）：
 * - `syncPlaylist: true` 时同步允许 `MusicPlayer` 拉取初始曲目（点击展开迷你播放器、恢复断点会话或进入 `/music` 页）；
 * - `syncPlaylist: false`（默认，如悬浮球悬停）仅挂载 `MusicRuntimeController`，不提前发歌单/歌词请求、不写 `localStorage`。
 */
export function activateMusicRuntime(options?: { syncPlaylist?: boolean }): void {
  if (typeof window === 'undefined')
    return
  preloadMusicRuntime()
  if (options?.syncPlaylist)
    requestMusicPlaylistSync()
  if (sharedSession.runtimeActivated)
    return
  sharedSession.runtimeActivated = true
  activationListeners.forEach(listener => listener())
}

export function isMusicRuntimeActivated(): boolean {
  return sharedSession.runtimeActivated
}

export function subscribeMusicRuntimeActivation(listener: () => void): () => void {
  activationListeners.add(listener)
  return () => {
    activationListeners.delete(listener)
  }
}

/** 仅供单元测试在用例间重置模块级音频与播放会话 */
export function resetMusicSessionForTests(): void {
  const prevAudio = audioRef.current
  if (prevAudio) {
    try {
      prevAudio.pause()
      prevAudio.removeAttribute('src')
      prevAudio.load()
    }
    catch { }
  }
  audioRef.current = null
  audioPrefsBootstrappedRef.current = false
  runtimeModulePromise = null
  pendingPlayRef.current = false
  pendingSeekRef.current = null
  prevTrackIdRef.current = null
  playlistRef.current = []
  currentIndexRef.current = null
  playModeRef.current = 'repeat-all'
  playlistStateRef.current = 'pending'
  playlistCompleteRef.current = true
  deferredPlaylistRef.current = null
  playlistLoadingRef.current = null
  playlistWantedRef.current = false
  playedMsRef.current = 0
  playingSinceRef.current = null
  seekedNearEndRef.current = false
  abnormalEndCountRef.current = 0
  mediaStormCountRef.current = 0
  lastMediaSkipAtRef.current = 0
  circuitTrippedRef.current = false
  hasPlayedRef.current = false
  volumeRef.current = 1
  isMutedRef.current = false
  sharedSession.hydrated = false
  sharedSession.runtimeActivated = false
  sharedSession.playlistSyncRequested = false
  sharedSession.clock = createMusicClock()
  sharedSession.lyricCursor = createLyricCursor()
  sharedSession.syncActiveProvider = null
  sharedSession.runtimeActions = null
  sharedSession.queuedCommands = []
  activationListeners.forEach(listener => listener())
  playlistSyncListeners.forEach(listener => listener())
}
