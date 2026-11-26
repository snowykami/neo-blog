'use client'

import type {
  RuntimeLyricsSnapshot,
  RuntimePreferencesSnapshot,
  RuntimeVolumeSnapshot,
} from './music-runtime-controller'
import type {
  LyricCursor,
  MusicActionsValue,
  MusicClock,
  MusicContextValue,
  MusicLyricsValue,
  MusicPlaybackValue,
  MusicPreferencesValue,
  MusicVolumeValue,
  PlayMode,
} from './music-session'
import type { LyricTranslationSelection } from '@/lib/lyrics/lyric-language'
import type { LyricTargetLang } from '@/lib/lyrics/target-lang'
import type { MusicTrack } from '@/models/music'
import dynamic from 'next/dynamic'
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { EMPTY_MUSIC_LYRICS_STATE } from './music-lyrics-engine-state'
import {
  activateMusicRuntime,
  audioRef,
  clearQueuedStepCommands,
  createLyricCursor,
  createMusicClock,
  currentIndexRef,
  deferredPlaylistRef,
  ensureSingletonAudio,
  extractLyricLinePlainText,
  getNextPlayMode,
  hasDesktopIslandSession,
  hasPersistedMusicSession,
  hasPlayedRef,
  hasStoredPlaybackRecord,
  isMusicPlaylistSyncRequested,
  isMusicRuntimeActivated,
  isMutedRef,
  loadMusicRuntimeModule,
  MAX_ABNORMAL_AUTO_SKIPS,
  MAX_MEDIA_SESSION_STORM_SKIPS,
  MIN_VALID_PLAY_MS,
  pendingPlayRef,
  pendingSeekRef,
  PLAY_MODES,
  playlistCompleteRef,
  playlistLoadingRef,
  playlistRef,
  playlistStateRef,
  playlistWantedRef,
  playModeRef,
  PREFETCH_TTL_MS,
  preloadMusicRuntime,
  prevTrackIdRef,
  rebasePlaylist,
  requestMusicPlaylistSync,
  resetMusicSessionForTests,
  sharedSession,
  shouldPrefetch,
  subscribeMusicPlaylistSync,
  subscribeMusicRuntimeActivation,
  volumeRef,
} from './music-session'

export {
  activateMusicRuntime,
  getNextPlayMode,
  hasDesktopIslandSession,
  hasPersistedMusicSession,
  hasStoredPlaybackRecord,
  MAX_ABNORMAL_AUTO_SKIPS,
  MAX_MEDIA_SESSION_STORM_SKIPS,
  MIN_VALID_PLAY_MS,
  PLAY_MODES,
  PREFETCH_TTL_MS,
  preloadMusicRuntime,
  rebasePlaylist,
  requestMusicPlaylistSync,
  resetMusicSessionForTests,
  shouldPrefetch,
}
export type {
  LyricCursor,
  MusicActionsValue,
  MusicClock,
  MusicContextValue,
  MusicLyricsValue,
  MusicPlaybackValue,
  MusicPreferencesValue,
  MusicVolumeValue,
  PlayMode,
}

// 18 个重型副作用、MediaSession、偏好恢复与歌词引擎编排全部拆入懒加载控制器：
// 用户未开启音乐且本地无断点续播会话时，首屏与常规浏览不下载控制器 chunk、不创建 <audio>、不跑后台监听
const LazyMusicRuntimeController = dynamic(
  () => loadMusicRuntimeModule().then(m => m.MusicRuntimeController),
  { ssr: false },
)

const EMPTY_ADJACENT_TRACKS = { prev: null, next: null } as const

const DEFAULT_PREFERENCES_SNAPSHOT: RuntimePreferencesSnapshot = {
  showTranslation: true,
  translationLang: null,
  preferNativeTranslation: false,
  translationSelections: [],
  showRomaji: true,
  showLyricEffects: true,
  showLyricMoments: true,
  hdr: true,
}

const DEFAULT_LYRICS_SNAPSHOT: RuntimeLyricsSnapshot = {
  lyricLines: [],
  lyricStatus: EMPTY_MUSIC_LYRICS_STATE.status,
  lyrics: EMPTY_MUSIC_LYRICS_STATE.lyrics,
  lyricCandidates: EMPTY_MUSIC_LYRICS_STATE.candidates,
  lyricKind: EMPTY_MUSIC_LYRICS_STATE.kind,
  lyricSiteKind: EMPTY_MUSIC_LYRICS_STATE.siteKind,
  lyricIsSiteVersion: EMPTY_MUSIC_LYRICS_STATE.isSiteVersion,
  lyricSourcesPending: EMPTY_MUSIC_LYRICS_STATE.pending,
  lyricAnnotated: EMPTY_MUSIC_LYRICS_STATE.annotated,
  lyricAnnotationsGenerating: EMPTY_MUSIC_LYRICS_STATE.annotationsGenerating,
  hasTranslationLyric: false,
  canToggleTranslation: false,
  lyricAiTranslated: EMPTY_MUSIC_LYRICS_STATE.aiTranslated,
  lyricTranslationsGenerating: EMPTY_MUSIC_LYRICS_STATE.translationsGenerating,
  effectiveTranslationLang: EMPTY_MUSIC_LYRICS_STATE.effectiveTranslationLang,
  songLang: EMPTY_MUSIC_LYRICS_STATE.songLang,
  availableTranslationLangs: EMPTY_MUSIC_LYRICS_STATE.availableTranslationLangs,
  hasRomajiLyric: false,
  canToggleRomaji: false,
  lyricAiRomanized: EMPTY_MUSIC_LYRICS_STATE.aiRomanized,
  lyricPronunciationsGenerating: EMPTY_MUSIC_LYRICS_STATE.pronunciationsGenerating,
}

function createInitialPlaybackSnapshot(canAdopt: boolean): MusicPlaybackValue {
  if (!canAdopt) {
    return {
      playlist: [],
      currentIndex: null,
      currentTrack: null,
      isPlaying: false,
      hasPlayed: false,
      playMode: 'repeat-all',
      duration: null,
      playlistComplete: true,
      playlistLoading: false,
      pendingStep: null,
      playlistState: 'pending',
      adjacentTracks: EMPTY_ADJACENT_TRACKS,
    }
  }
  const playlist = playlistRef.current
  const currentIndex = currentIndexRef.current
  const currentTrack = currentIndex != null ? playlist[currentIndex] ?? null : null
  const audio = audioRef.current
  return {
    playlist,
    currentIndex,
    currentTrack,
    isPlaying: audio ? !audio.paused && !audio.ended : false,
    hasPlayed: hasPlayedRef.current,
    playMode: playModeRef.current,
    duration: audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null,
    playlistComplete: playlistCompleteRef.current,
    playlistLoading: Boolean(playlistLoadingRef.current),
    pendingStep: null,
    playlistState: playlistStateRef.current,
    adjacentTracks: EMPTY_ADJACENT_TRACKS,
  }
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

/** 播放时钟本身：需要在回调中读取进度（如定期保存进度）而不想因此重渲染时使用 */
export function useMusicClockStore(): MusicClock {
  const clock = useContext(MusicClockContext)
  if (!clock)
    throw new Error('useMusicClockStore must be used within MusicProvider')
  return clock
}

const falseSnapshot = () => false

/** 音乐运行时控制器是否已激活挂载（供悬浮组件与桌面灵动岛桥接按需挂载判断） */
export function useMusicRuntimeActive(): boolean {
  return useSyncExternalStore(subscribeMusicRuntimeActivation, isMusicRuntimeActivated, falseSnapshot)
}

/** 是否已允许拉取并同步初始歌单（存在断点会话、展开弹层或进入 /music 时为 true） */
export function useMusicPlaylistSyncActive(): boolean {
  return useSyncExternalStore(subscribeMusicPlaylistSync, isMusicPlaylistSyncRequested, falseSnapshot)
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
  return extractLyricLinePlainText(lyricLines[index])
}

export const MusicProvider: React.FC<{ children: React.ReactNode, musicEnabled?: boolean }> = ({
  children,
  musicEnabled = true,
}) => {
  const canAdopt = typeof window !== 'undefined' && sharedSession.hydrated
  const runtimeActive = useMusicRuntimeActive()

  const [clock] = useState(() => (typeof window === 'undefined' ? createMusicClock() : sharedSession.clock))
  const [lyricCursor] = useState(() => (typeof window === 'undefined' ? createLyricCursor() : sharedSession.lyricCursor))

  const [playbackValue, setPlaybackValue] = useState<MusicPlaybackValue>(() => createInitialPlaybackSnapshot(canAdopt))
  const [volumeState, setVolumeState] = useState<RuntimeVolumeSnapshot>(() => ({
    volume: canAdopt ? volumeRef.current : 1,
    isMuted: canAdopt ? isMutedRef.current : false,
  }))
  const [preferencesState, setPreferencesState] = useState<RuntimePreferencesSnapshot>(DEFAULT_PREFERENCES_SNAPSHOT)
  const [lyricsState, setLyricsState] = useState<RuntimeLyricsSnapshot>(DEFAULT_LYRICS_SNAPSHOT)

  // 仅当本地存在可恢复的断点续播会话、直接访问 /music 或曾配对桌面灵动岛时才自动激活控制器与歌单恢复；
  // 普通未开启音乐的访客全程保持零 chunk 下载、零歌单请求、零后台监听
  useEffect(() => {
    if (musicEnabled && hasPersistedMusicSession())
      activateMusicRuntime({ syncPlaylist: true })
  }, [musicEnabled])

  const syncShellPlayback = useCallback(() => {
    setPlaybackValue(createInitialPlaybackSnapshot(true))
  }, [])

  const syncShellAudioState = useCallback(() => {
    setVolumeState({ volume: volumeRef.current, isMuted: isMutedRef.current })
    setPlaybackValue(createInitialPlaybackSnapshot(true))
  }, [])

  const getAudio = useCallback(() => audioRef.current, [])

  const replacePlaylist = useCallback((tracks: MusicTrack[], startIndex = 0, startTime?: number) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.replacePlaylist(tracks, startIndex, startTime)
      return
    }
    clearQueuedStepCommands()
    ensureSingletonAudio()
    const index = tracks.length > 0 ? Math.max(0, Math.min(startIndex, tracks.length - 1)) : null
    const track = index == null ? null : tracks[index]
    pendingSeekRef.current = track && startTime != null && Number.isFinite(startTime) && startTime > 0
      ? { trackId: track.id, time: startTime }
      : null
    playlistRef.current = tracks
    currentIndexRef.current = index
    playlistStateRef.current = 'loaded'
    syncShellAudioState()
    activateMusicRuntime()
  }, [syncShellAudioState])

  const updatePlaylist = useCallback((tracks: MusicTrack[]) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.updatePlaylist(tracks)
      return
    }
    const index = currentIndexRef.current
    const current = index == null ? null : playlistRef.current[index] ?? null
    const next = rebasePlaylist(tracks, current, index)
    playlistRef.current = next.tracks
    currentIndexRef.current = next.index
    playlistStateRef.current = 'loaded'
    syncShellPlayback()
    activateMusicRuntime()
  }, [syncShellPlayback])

  const markPlaylistFailed = useCallback(() => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.markPlaylistFailed()
      return
    }
    if (playlistStateRef.current !== 'loaded')
      playlistStateRef.current = 'failed'
    syncShellPlayback()
  }, [syncShellPlayback])

  const deferPlaylist = useCallback((load: () => Promise<MusicTrack[]>, partial: boolean) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.deferPlaylist(load, partial)
      return
    }
    deferredPlaylistRef.current = load
    playlistLoadingRef.current = null
    playlistCompleteRef.current = !partial
    syncShellPlayback()
    activateMusicRuntime()
  }, [syncShellPlayback])

  const ensurePlaylist = useCallback((): Promise<boolean> => {
    if (sharedSession.runtimeActions)
      return sharedSession.runtimeActions.ensurePlaylist()
    activateMusicRuntime({ syncPlaylist: true })
    if (!deferredPlaylistRef.current) {
      playlistWantedRef.current = true
      return Promise.resolve(playlistCompleteRef.current)
    }
    return new Promise<boolean>((resolve) => {
      sharedSession.queuedCommands.push({ type: 'ensurePlaylist', resolve })
    })
  }, [])

  const playTrack = useCallback((index: number, startTime?: number) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.playTrack(index, startTime)
      return
    }
    if (index < 0 || index >= playlistRef.current.length)
      return
    clearQueuedStepCommands()
    const track = playlistRef.current[index]
    const audio = ensureSingletonAudio()
    currentIndexRef.current = index
    pendingSeekRef.current = track && startTime != null && Number.isFinite(startTime) && startTime >= 0
      ? { trackId: track.id, time: startTime }
      : null
    if (audio && track) {
      if (prevTrackIdRef.current !== track.id) {
        prevTrackIdRef.current = track.id
        audio.src = track.audio || ''
      }
      if (startTime != null && Number.isFinite(startTime) && startTime >= 0) {
        try {
          audio.currentTime = startTime
        }
        catch { }
      }
      pendingPlayRef.current = false
      void audio.play().catch(() => {})
    }
    else {
      pendingPlayRef.current = true
    }
    syncShellAudioState()
    activateMusicRuntime({ syncPlaylist: true })
  }, [syncShellAudioState])

  const playSong = useCallback((track: MusicTrack, startTime?: number) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.playSong(track, startTime)
      return
    }
    activateMusicRuntime({ syncPlaylist: true })
    clearQueuedStepCommands()
    const existing = playlistRef.current.findIndex(item => item.id === track.id)
    if (existing >= 0) {
      playTrack(existing, startTime)
      return
    }
    const insertAt = (currentIndexRef.current ?? -1) + 1
    const tracks = [...playlistRef.current.slice(0, insertAt), track, ...playlistRef.current.slice(insertAt)]
    playlistRef.current = tracks
    playTrack(insertAt, startTime)
  }, [playTrack])

  const startShellCurrentTrack = useCallback((audio: HTMLAudioElement) => {
    const idx = currentIndexRef.current
    const track = idx == null ? null : playlistRef.current[idx] ?? null
    if (track) {
      if (prevTrackIdRef.current !== track.id) {
        prevTrackIdRef.current = track.id
        audio.src = track.audio || ''
      }
      pendingPlayRef.current = false
      void audio.play().catch(() => {})
    }
    else {
      pendingPlayRef.current = true
    }
  }, [])

  const play = useCallback(() => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.play()
      return
    }
    const audio = ensureSingletonAudio()
    if (audio)
      startShellCurrentTrack(audio)
    syncShellAudioState()
    activateMusicRuntime({ syncPlaylist: true })
  }, [startShellCurrentTrack, syncShellAudioState])

  const pause = useCallback(() => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.pause()
      return
    }
    audioRef.current?.pause()
  }, [])

  const togglePlay = useCallback(() => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.togglePlay()
      return
    }
    const audio = ensureSingletonAudio()
    if (audio) {
      if (audio.paused)
        startShellCurrentTrack(audio)
      else
        audio.pause()
    }
    syncShellAudioState()
    activateMusicRuntime({ syncPlaylist: true })
  }, [startShellCurrentTrack, syncShellAudioState])

  const next = useCallback(() => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.next()
      return
    }
    sharedSession.queuedCommands.push({ type: 'next' })
    activateMusicRuntime({ syncPlaylist: true })
  }, [])

  const prev = useCallback(() => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.prev()
      return
    }
    sharedSession.queuedCommands.push({ type: 'prev' })
    activateMusicRuntime({ syncPlaylist: true })
  }, [])

  const setPlayMode = useCallback((mode: PlayMode) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.setPlayMode(mode)
      return
    }
    playModeRef.current = mode
    try {
      localStorage.setItem('music-play-mode', JSON.stringify(mode))
    }
    catch { }
    setPlaybackValue(prevState => ({ ...prevState, playMode: mode }))
  }, [])

  const seek = useCallback((seconds: number) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.seek(seconds)
      return
    }
    const audio = audioRef.current
    if (!audio)
      return
    const clamped = Math.max(0, Math.min(seconds, audio.duration || seconds))
    clock.set(clamped)
    try {
      audio.currentTime = clamped
    }
    catch { }
  }, [clock])

  const setVolume = useCallback((v: number) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.setVolume(v)
      return
    }
    const nextVolume = Math.max(0, Math.min(1, v))
    volumeRef.current = nextVolume
    if (audioRef.current)
      audioRef.current.volume = nextVolume
    try {
      localStorage.setItem('music-volume', JSON.stringify(nextVolume))
    }
    catch { }
    setVolumeState(prevState => ({ ...prevState, volume: nextVolume }))
  }, [])

  const adjustVolume = useCallback((delta: number) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.adjustVolume(delta)
      return
    }
    setVolumeState((prevState) => {
      const nextVolume = Math.max(0, Math.min(1, prevState.volume + delta))
      volumeRef.current = nextVolume
      if (audioRef.current)
        audioRef.current.volume = nextVolume
      try {
        localStorage.setItem('music-volume', JSON.stringify(nextVolume))
      }
      catch { }
      return { ...prevState, volume: nextVolume }
    })
  }, [])

  const toggleMuted = useCallback(() => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.toggleMuted()
      return
    }
    setVolumeState((prevState) => {
      const nextMuted = !prevState.isMuted
      isMutedRef.current = nextMuted
      if (audioRef.current)
        audioRef.current.muted = nextMuted
      try {
        localStorage.setItem('music-muted', JSON.stringify(nextMuted))
      }
      catch { }
      return { ...prevState, isMuted: nextMuted }
    })
  }, [])

  const setShowTranslation = useCallback((show: boolean) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.setShowTranslation(show)
      return
    }
    setPreferencesState(prevState => ({ ...prevState, showTranslation: show }))
    sharedSession.queuedCommands.push({ type: 'setShowTranslation', show })
    activateMusicRuntime()
  }, [])

  const setTranslationLang = useCallback((lang: LyricTargetLang | null, preferNative = false) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.setTranslationLang(lang, preferNative)
      return
    }
    sharedSession.queuedCommands.push({ type: 'setTranslationLang', lang, preferNative })
    activateMusicRuntime()
  }, [])

  const setTranslationSelections = useCallback((selections: LyricTranslationSelection[]) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.setTranslationSelections(selections)
      return
    }
    sharedSession.queuedCommands.push({ type: 'setTranslationSelections', selections })
    activateMusicRuntime()
  }, [])

  const setShowRomaji = useCallback((show: boolean) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.setShowRomaji(show)
      return
    }
    setPreferencesState(prevState => ({ ...prevState, showRomaji: show }))
    sharedSession.queuedCommands.push({ type: 'setShowRomaji', show })
    activateMusicRuntime()
  }, [])

  const setShowLyricEffects = useCallback((show: boolean) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.setShowLyricEffects(show)
      return
    }
    setPreferencesState(prevState => ({ ...prevState, showLyricEffects: show }))
    sharedSession.queuedCommands.push({ type: 'setShowLyricEffects', show })
    activateMusicRuntime()
  }, [])

  const setShowLyricMoments = useCallback((show: boolean) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.setShowLyricMoments(show)
      return
    }
    setPreferencesState(prevState => ({ ...prevState, showLyricMoments: show }))
    sharedSession.queuedCommands.push({ type: 'setShowLyricMoments', show })
    activateMusicRuntime()
  }, [])

  const setHdr = useCallback((enabled: boolean) => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.setHdr(enabled)
      return
    }
    setPreferencesState(prevState => ({ ...prevState, hdr: enabled }))
    sharedSession.queuedCommands.push({ type: 'setHdr', enabled })
    activateMusicRuntime()
  }, [])

  const refreshLyrics = useCallback(() => {
    if (sharedSession.runtimeActions) {
      sharedSession.runtimeActions.refreshLyrics()
      return
    }
    sharedSession.queuedCommands.push({ type: 'refreshLyrics' })
    activateMusicRuntime()
  }, [])

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
    setTranslationLang,
    setTranslationSelections,
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
    setTranslationLang,
    setTranslationSelections,
    setShowRomaji,
    setShowLyricEffects,
    setShowLyricMoments,
    setHdr,
    refreshLyrics,
  ])

  const volumeValue = useMemo<MusicVolumeValue>(() => ({
    volume: volumeState.volume,
    isMuted: volumeState.isMuted,
    setVolume,
    adjustVolume,
    toggleMuted,
  }), [volumeState, setVolume, adjustVolume, toggleMuted])

  const preferencesValue = useMemo<MusicPreferencesValue>(() => ({
    ...preferencesState,
    setShowTranslation,
    setTranslationLang,
    setTranslationSelections,
    setShowRomaji,
    setShowLyricEffects,
    setShowLyricMoments,
    setHdr,
  }), [
    preferencesState,
    setShowTranslation,
    setTranslationLang,
    setTranslationSelections,
    setShowRomaji,
    setShowLyricEffects,
    setShowLyricMoments,
    setHdr,
  ])

  const lyricsValue = useMemo<MusicLyricsValue>(() => ({
    lyricCursor,
    ...lyricsState,
    refreshLyrics,
  }), [lyricCursor, lyricsState, refreshLyrics])

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
                <MusicContext value={combinedValue}>
                  {runtimeActive && (
                    <LazyMusicRuntimeController
                      clock={clock}
                      lyricCursor={lyricCursor}
                      onPlaybackChange={setPlaybackValue}
                      onVolumeChange={setVolumeState}
                      onPreferencesChange={setPreferencesState}
                      onLyricsChange={setLyricsState}
                    />
                  )}
                  {children}
                </MusicContext>
              </MusicLyricsContext>
            </MusicPreferencesContext>
          </MusicVolumeContext>
        </MusicPlaybackContext>
      </MusicActionsContext>
    </MusicClockContext>
  )
}
