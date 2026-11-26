'use client'

import type { MusicLyricsState } from './music-lyrics-engine-state'
import type {
  MusicActionsValue,
  MusicLyricsValue,
  MusicPlaybackValue,
  MusicPreferencesValue,
  MusicVolumeValue,
  PlayMode,
  ValueStore,
} from './music-session'
import type { LyricTranslationSelection } from '@/lib/lyrics/lyric-language'
import type { LyricTargetLang, PronunciationLangBucket, TranslationSongBucket } from '@/lib/lyrics/target-lang'
import type { MusicTrack } from '@/models/music'
import { useLocale, useTranslations } from 'next-intl'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  findActiveLyricLineIndex,
  getLyricLineText,
  getVocalLyricLines,
  LYRIC_PLACEHOLDERS,
} from '@/lib/lyrics/line-utils'
import {
  normalizeLyricLangTag,
  resolveBucketSelections,
  resolvePronunciationEnabled,
  resolveTranslationEnabled,
  SUPPORTED_LYRIC_TARGET_LANGS,
  toLyricTargetLang,
} from '@/lib/lyrics/target-lang'
import { registerTelemetryContext } from '@/lib/telemetry/context'
import { formatMusicCoverUrl } from '@/utils/common/image'
import { isAdmin } from '@/utils/common/permission'
import { useOptionalAuth } from './auth-context'
import { EMPTY_MUSIC_LYRICS_STATE } from './music-lyrics-engine-state'
import {
  abnormalEndCountRef,
  audioRef,
  circuitTrippedRef,
  currentIndexRef,
  deferredPlaylistRef,
  ensureSingletonAudio,
  hasPlayedRef,
  isMutedRef,
  lastMediaSkipAtRef,
  MAX_ABNORMAL_AUTO_SKIPS,
  MAX_MEDIA_SESSION_STORM_SKIPS,
  MEDIA_SESSION_STORM_WINDOW_MS,
  mediaStormCountRef,
  MIN_VALID_PLAY_MS,
  NEAR_END_SEEK_THRESHOLD_S,
  pendingPlayRef,
  pendingSeekRef,
  PLAY_MODES,
  playedMsRef,
  playingSinceRef,
  playlistCompleteRef,
  playlistLoadingRef,
  playlistRef,
  playlistStateRef,
  playlistWantedRef,
  playModeRef,
  prevTrackIdRef,
  rebasePlaylist,
  requestMusicPlaylistSync,
  seekedNearEndRef,
  sharedSession,
  volumeRef,
} from './music-session'

const loadLyricsEngine = () => import('./music-lyrics-engine')
const loadRhythm = () => import('@/lib/lyrics/rhythm/source')
const loadAdjacentPreloader = () => import('./preload-adjacent')

const MEDIA_SESSION_MIN_INTERVAL_MS = 1000
const PLAYLIST_FAILED_TOAST_ID = 'music-playlist-failed'
const PLAYBACK_FAILED_TOAST_ID = 'music-playback-failed'
const MEDIA_ERR_ABORTED = 1

const STORAGE_KEY_PLAY_MODE = 'music-play-mode'
const STORAGE_KEY_SHOW_TRANSLATION = 'music-show-translation'
const STORAGE_KEY_TRANSLATION_SELECTIONS = 'music-translation-selections'
const STORAGE_KEY_TRANSLATION_LANG = 'music-translation-lang'
const STORAGE_KEY_TRANSLATION_PREFER_NATIVE = 'music-translation-prefer-native'
const STORAGE_KEY_PRONUNCIATION_PREFS = 'music-pronunciation-prefs'
const STORAGE_KEY_TRANSLATION_PREFS = 'music-translation-prefs'
const STORAGE_KEY_TRANSLATION_SELECTIONS_BY_BUCKET = 'music-translation-selections-by-bucket'
const STORAGE_KEY_SHOW_ROMAJI = 'music-show-romaji'
const STORAGE_KEY_SHOW_LYRIC_EFFECTS = 'music-show-lyric-effects'
const STORAGE_KEY_SHOW_LYRIC_MOMENTS = 'music-show-lyric-moments'
const STORAGE_KEY_HDR = 'music-hdr'
const LEGACY_STORAGE_KEY_LYRIC_MODE = 'music-lyric-mode'

function normalizeStoredSelections(raw: unknown): LyricTranslationSelection[] {
  if (!Array.isArray(raw))
    return []
  const result: LyricTranslationSelection[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object')
      continue
    const langRaw = (item as { lang?: unknown }).lang
    const normalizedLang = typeof langRaw === 'string' ? normalizeLyricLangTag(langRaw) : null
    if (!normalizedLang || !SUPPORTED_LYRIC_TARGET_LANGS.includes(normalizedLang as LyricTargetLang))
      continue
    const preferNative = Boolean((item as { preferNative?: unknown }).preferNative)
    const key = `${normalizedLang}:${preferNative}`
    if (seen.has(key))
      continue
    seen.add(key)
    result.push({ lang: normalizedLang as LyricTargetLang, preferNative })
    if (result.length >= 2)
      break
  }
  return result
}

function normalizeStoredBooleanMap(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return {}
  const result: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean')
      result[key] = value
  }
  return result
}

function normalizeStoredSelectionsMap(raw: unknown): Record<string, LyricTranslationSelection[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return {}
  const result: Record<string, LyricTranslationSelection[]> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value))
      continue
    result[key] = normalizeStoredSelections(value)
  }
  return result
}

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

function makeMediaArtwork(url?: string) {
  if (!url)
    return []
  return [
    { src: formatMusicCoverUrl(url, 512), sizes: '512x512', type: 'image/jpeg' },
    { src: formatMusicCoverUrl(url, 96), sizes: '96x96', type: 'image/jpeg' },
  ]
}

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

function useLazyModule<T>(load: () => Promise<T>, enabled: boolean): T | null {
  const [loaded, setLoaded] = useState<T | null>(null)
  useEffect(() => {
    if (!enabled || loaded)
      return
    let cancelled = false
    load().then((mod) => {
      if (!cancelled)
        setLoaded(mod)
    }, () => {})
    return () => {
      cancelled = true
    }
  }, [enabled, load, loaded])
  return loaded
}

export type RuntimeVolumeSnapshot = Pick<MusicVolumeValue, 'volume' | 'isMuted'>
export type RuntimePreferencesSnapshot = Omit<
  MusicPreferencesValue,
  | 'setShowTranslation'
  | 'setTranslationLang'
  | 'setTranslationSelections'
  | 'setShowRomaji'
  | 'setShowLyricEffects'
  | 'setShowLyricMoments'
  | 'setHdr'
>
export type RuntimeLyricsSnapshot = Omit<MusicLyricsValue, 'lyricCursor' | 'refreshLyrics'>

export interface MusicRuntimeControllerProps {
  clock: ValueStore<number>
  lyricCursor: ValueStore<number | null>
  onPlaybackChange: (next: MusicPlaybackValue) => void
  onVolumeChange: (next: RuntimeVolumeSnapshot) => void
  onPreferencesChange: (next: RuntimePreferencesSnapshot) => void
  onLyricsChange: (next: RuntimeLyricsSnapshot) => void
}

/**
 * 音乐运行时控制器（按需懒加载）：
 * 承载 Audio 会话接管、9 类媒体事件、切歌防风暴熔断、MediaSession 系统控制中心同步、
 * 12 项本地歌词/显示偏好恢复、节拍分析、前后曲目空闲预热及歌词引擎编排。
 * 未开启音乐且无断点会话的访客不会下载或挂载本模块。
 */
export function MusicRuntimeController({
  clock,
  lyricCursor,
  onPlaybackChange,
  onVolumeChange,
  onPreferencesChange,
  onLyricsChange,
}: MusicRuntimeControllerProps) {
  const [playlist, setPlaylist] = useState<MusicTrack[]>(() => playlistRef.current)
  const [currentIndex, setCurrentIndex] = useState<number | null>(() => currentIndexRef.current)
  const [isPlaying, setIsPlaying] = useState(() => (audioRef.current ? !audioRef.current.paused && !audioRef.current.ended : false))
  const [hasPlayed, setHasPlayed] = useState(() => hasPlayedRef.current)
  const [playMode, setPlayModeState] = useState<PlayMode>(() => playModeRef.current)
  const [duration, setDuration] = useState<number | null>(() => (
    audioRef.current && Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0
      ? audioRef.current.duration
      : null
  ))
  const [volume, setVolumeState] = useState(() => volumeRef.current)
  const [isMuted, setIsMuted] = useState(() => isMutedRef.current)
  const volumeSyncedRef = useRef(sharedSession.hydrated)

  const locale = useLocale()
  const targetLang = useMemo(() => toLyricTargetLang(locale), [locale])
  const [defaultShowTranslation, setDefaultShowTranslation] = useState(true)
  const [defaultTranslationSelections, setDefaultTranslationSelections] = useState<LyricTranslationSelection[]>([])
  const [translationPrefs, setTranslationPrefs] = useState<Record<string, boolean>>({})
  const [translationSelectionsByBucket, setTranslationSelectionsByBucket] = useState<Record<string, LyricTranslationSelection[]>>({})
  const [translationRequested, setTranslationRequested] = useState(false)
  const [defaultShowRomaji, setDefaultShowRomaji] = useState(true)
  const [pronunciationPrefs, setPronunciationPrefs] = useState<Record<string, boolean>>({})
  const [romajiRequested, setRomajiRequested] = useState(false)
  const [showLyricEffects, setShowLyricEffectsState] = useState(true)
  const [showLyricMoments, setShowLyricMomentsState] = useState(true)
  const [hdr, setHdrState] = useState(true)

  const currentTrack = currentIndex != null ? playlist[currentIndex] ?? null : null
  const currentTrackId = currentTrack?.id ?? null
  const auth = useOptionalAuth()
  const userIsAdmin = Boolean(auth?.user && isAdmin({ user: auth.user }))
  const adminRef = useRef(userIsAdmin)
  adminRef.current = userIsAdmin
  const trackDurationRef = useRef<number | null>(currentTrack?.duration ?? null)
  trackDurationRef.current = currentTrack?.duration ?? null
  const getAudio = useCallback(() => audioRef.current, [])

  const t = useTranslations('MusicPlayer')
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])

  // 错误报告与崩溃补报附带正在播放的歌曲与位置
  useEffect(() => registerTelemetryContext('music', () => {
    const audio = audioRef.current
    return currentTrack
      ? { track_id: currentTrack.id, track: currentTrack.name, position_s: audio ? Math.round(audio.currentTime) : null, playing: audio ? !audio.paused : false }
      : null
  }), [currentTrack])

  // 供事件回调读取最新值
  useEffect(() => {
    playlistRef.current = playlist
    currentIndexRef.current = currentIndex
    playModeRef.current = playMode
  }, [playlist, currentIndex, playMode])

  // 创建或复用单例 audio 元素并恢复本地偏好
  useEffect(() => {
    if (typeof window === 'undefined')
      return

    const firstHydration = !sharedSession.hydrated
    const audio = ensureSingletonAudio()
    sharedSession.hydrated = true

    try {
      if (firstHydration) {
        const storedVolume = localStorage.getItem('music-volume')
        if (storedVolume != null) {
          const nextVolume = Math.max(0, Math.min(1, Number(JSON.parse(storedVolume))))
          if (Number.isFinite(nextVolume)) {
            volumeRef.current = nextVolume
            setVolumeState(nextVolume)
            if (audio)
              audio.volume = nextVolume
          }
        }

        const storedMuted = localStorage.getItem('music-muted')
        if (storedMuted != null) {
          const nextMuted = Boolean(JSON.parse(storedMuted))
          isMutedRef.current = nextMuted
          setIsMuted(nextMuted)
          if (audio)
            audio.muted = nextMuted
        }

        const storedPlayMode = JSON.parse(localStorage.getItem(STORAGE_KEY_PLAY_MODE) ?? 'null')
        if (PLAY_MODES.includes(storedPlayMode)) {
          playModeRef.current = storedPlayMode
          setPlayModeState(storedPlayMode)
        }
      }

      const storedEffects = readStoredBoolean(STORAGE_KEY_SHOW_LYRIC_EFFECTS)
      if (storedEffects != null)
        setShowLyricEffectsState(storedEffects)

      const storedMoments = readStoredBoolean(STORAGE_KEY_SHOW_LYRIC_MOMENTS)
      if (storedMoments != null)
        setShowLyricMomentsState(storedMoments)

      const storedHdr = readStoredBoolean(STORAGE_KEY_HDR)
      if (storedHdr != null)
        setHdrState(storedHdr)

      const storedSelectionsRaw = localStorage.getItem(STORAGE_KEY_TRANSLATION_SELECTIONS)
      if (storedSelectionsRaw != null) {
        const parsedSelections = normalizeStoredSelections(JSON.parse(storedSelectionsRaw))
        if (parsedSelections.length > 0)
          setDefaultTranslationSelections(parsedSelections)
      }
      else {
        const storedTranslationLangRaw = localStorage.getItem(STORAGE_KEY_TRANSLATION_LANG)
        if (storedTranslationLangRaw != null) {
          const parsedLang = JSON.parse(storedTranslationLangRaw)
          const normalizedLang = typeof parsedLang === 'string' ? normalizeLyricLangTag(parsedLang) : null
          if (normalizedLang && SUPPORTED_LYRIC_TARGET_LANGS.includes(normalizedLang as LyricTargetLang)) {
            const storedPreferNative = readStoredBoolean(STORAGE_KEY_TRANSLATION_PREFER_NATIVE)
            setDefaultTranslationSelections([
              { lang: normalizedLang as LyricTargetLang, preferNative: storedPreferNative === true },
            ])
          }
        }
      }

      const storedTranslation = readStoredBoolean(STORAGE_KEY_SHOW_TRANSLATION)
      const storedRomaji = readStoredBoolean(STORAGE_KEY_SHOW_ROMAJI)
      if (storedTranslation != null || storedRomaji != null) {
        if (storedTranslation != null)
          setDefaultShowTranslation(storedTranslation)
        if (storedRomaji != null)
          setDefaultShowRomaji(storedRomaji)
      }
      else {
        const legacyMode = localStorage.getItem(LEGACY_STORAGE_KEY_LYRIC_MODE)
        if (legacyMode != null) {
          const mode = JSON.parse(legacyMode)
          setDefaultShowTranslation(mode === 'translation')
          setDefaultShowRomaji(mode === 'romaji')
          localStorage.removeItem(LEGACY_STORAGE_KEY_LYRIC_MODE)
        }
      }

      const storedPronunciationPrefsRaw = localStorage.getItem(STORAGE_KEY_PRONUNCIATION_PREFS)
      if (storedPronunciationPrefsRaw != null)
        setPronunciationPrefs(normalizeStoredBooleanMap(JSON.parse(storedPronunciationPrefsRaw)))

      const storedTranslationPrefsRaw = localStorage.getItem(STORAGE_KEY_TRANSLATION_PREFS)
      if (storedTranslationPrefsRaw != null)
        setTranslationPrefs(normalizeStoredBooleanMap(JSON.parse(storedTranslationPrefsRaw)))

      const storedSelectionsByBucketRaw = localStorage.getItem(STORAGE_KEY_TRANSLATION_SELECTIONS_BY_BUCKET)
      if (storedSelectionsByBucketRaw != null)
        setTranslationSelectionsByBucket(normalizeStoredSelectionsMap(JSON.parse(storedSelectionsByBucketRaw)))
    }
    catch (error) {
      console.error('Failed to restore music preferences:', error)
    }
  }, [])

  useEffect(() => {
    if (!volumeSyncedRef.current) {
      volumeSyncedRef.current = true
      return
    }
    volumeRef.current = volume
    isMutedRef.current = isMuted
    if (!audioRef.current)
      return
    audioRef.current.volume = volume
    audioRef.current.muted = isMuted
  }, [isMuted, volume])

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
    const audio = ensureSingletonAudio()
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
    setDuration(null)
    clock.set(0)
    audio.src = track?.audio || ''
    audio.currentTime = 0
    if (pendingPlayRef.current) {
      pendingPlayRef.current = false
      void audio.play().catch(() => {})
    }
  }, [clock, currentTrackId, resetTrackPlayStats])

  // 节拍分析（韵律动效）
  const currentTrackAudio = currentTrack?.audio ?? null
  useEffect(() => {
    const audio = audioRef.current
    if (!showLyricEffects || currentTrackId == null || !audio)
      return
    const controller = new AbortController()
    const request = () => {
      if (!audio.paused && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && document.visibilityState === 'visible') {
        void loadRhythm().then(({ requestRhythm }) => {
          if (!controller.signal.aborted)
            requestRhythm(currentTrackId, currentTrackAudio, controller.signal, { isAdmin: adminRef.current, expectedDurationMs: trackDurationRef.current })
        }, () => {})
      }
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

  useEffect(() => {
    if (!userIsAdmin || !showLyricEffects || currentTrackId == null)
      return
    void loadRhythm().then((mod) => {
      mod.syncRhythmForAdmin?.(currentTrackId, trackDurationRef.current)
    }, () => {})
  }, [currentTrackId, showLyricEffects, userIsAdmin])

  const [playlistState, setPlaylistState] = useState<'pending' | 'loaded' | 'failed'>(() => playlistStateRef.current)
  const markPlaylistFailed = useCallback(() => {
    setPlaylistState((state) => {
      const next = state === 'loaded' ? state : 'failed'
      playlistStateRef.current = next
      return next
    })
  }, [])

  const updatePlaylist = useCallback((tracks: MusicTrack[]) => {
    const index = currentIndexRef.current
    const current = index == null ? null : playlistRef.current[index] ?? null
    const next = rebasePlaylist(tracks, current, index)
    playlistRef.current = next.tracks
    currentIndexRef.current = next.index
    playlistStateRef.current = 'loaded'
    setPlaylist(next.tracks)
    setCurrentIndex(next.index)
    setPlaylistState('loaded')
  }, [])

  const [playlistComplete, setPlaylistComplete] = useState(() => playlistCompleteRef.current)
  const [playlistLoading, setPlaylistLoading] = useState(() => Boolean(playlistLoadingRef.current))
  const ensurePlaylistRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))

  useEffect(() => {
    const sync = () => {
      setPlaylist(playlistRef.current)
      setCurrentIndex(currentIndexRef.current)
      setPlaylistState(playlistStateRef.current)
      setPlaylistComplete(playlistCompleteRef.current)
      setPlaylistLoading(Boolean(playlistLoadingRef.current))
    }
    sharedSession.syncActiveProvider = sync
    sync()
    return () => {
      if (sharedSession.syncActiveProvider === sync)
        sharedSession.syncActiveProvider = null
    }
  }, [])

  const ensurePlaylist = useCallback((): Promise<boolean> => {
    requestMusicPlaylistSync()
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
        const index = currentIndexRef.current
        const current = index == null ? null : playlistRef.current[index] ?? null
        const next = rebasePlaylist(tracks, current, index)
        playlistRef.current = next.tracks
        currentIndexRef.current = next.index
        playlistStateRef.current = 'loaded'
        playlistCompleteRef.current = true
        sharedSession.syncActiveProvider?.()
        return true
      })
      .catch((error) => {
        console.error('Failed to fetch playlist:', error)
        return playlistCompleteRef.current
      })
      .finally(() => {
        if (playlistLoadingRef.current === loading) {
          playlistLoadingRef.current = null
          sharedSession.syncActiveProvider?.()
        }
      })
    playlistLoadingRef.current = loading
    sharedSession.syncActiveProvider?.()
    return loading
  }, [])

  useEffect(() => {
    ensurePlaylistRef.current = ensurePlaylist
  }, [ensurePlaylist])

  // 若挂载前已有 ensurePlaylist 排队诉求且存在 deferredPlaylist，挂载时立即触发补全
  useEffect(() => {
    if (playlistWantedRef.current && deferredPlaylistRef.current)
      void ensurePlaylist()
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

  const shufflePlanRef = useRef<{ forIndex: number | null, forLen: number, prev: number | null, next: number | null }>({
    forIndex: null,
    forLen: 0,
    prev: null,
    next: null,
  })
  const [shufflePlan, setShufflePlan] = useState(shufflePlanRef.current)

  useEffect(() => {
    if (playMode !== 'shuffle' || !playlistComplete || currentIndex == null || playlist.length <= 1) {
      const empty = { forIndex: null, forLen: 0, prev: null, next: null }
      shufflePlanRef.current = empty
      setShufflePlan(prev => (prev.forIndex == null && prev.forLen === 0 ? prev : empty))
      return
    }
    const len = playlist.length
    const pickOther = (excludeA: number, excludeB: number | null) => {
      if (len <= 2)
        return (excludeA + 1) % len
      let idx = Math.floor(Math.random() * len)
      if (idx === excludeA || idx === excludeB)
        idx = (idx + 1) % len
      if (idx === excludeA || idx === excludeB)
        idx = (idx + 1) % len
      return idx
    }
    const nextIdx = pickOther(currentIndex, null)
    const prevIdx = pickOther(currentIndex, nextIdx)
    const plan = { forIndex: currentIndex, forLen: len, prev: prevIdx, next: nextIdx }
    shufflePlanRef.current = plan
    setShufflePlan(plan)
  }, [currentIndex, playMode, playlist.length, playlistComplete])

  const adjacentTracks = useMemo<{ prev: MusicTrack | null, next: MusicTrack | null }>(() => {
    if (!playlistComplete || currentIndex == null || playlist.length <= 1)
      return { prev: null, next: null }
    const len = playlist.length
    if (playMode === 'shuffle') {
      if (shufflePlan.forIndex !== currentIndex || shufflePlan.forLen !== len)
        return { prev: null, next: null }
      const next = shufflePlan.next != null ? playlist[shufflePlan.next] ?? null : null
      const prev = shufflePlan.prev != null ? playlist[shufflePlan.prev] ?? null : null
      return {
        prev: prev && prev.id !== currentTrack?.id ? prev : null,
        next: next && next.id !== currentTrack?.id ? next : null,
      }
    }
    const next = playlist[(currentIndex + 1) % len] ?? null
    const prev = playlist[(currentIndex - 1 + len) % len] ?? null
    return {
      prev: prev && prev.id !== currentTrack?.id ? prev : null,
      next: next && next.id !== currentTrack?.id ? next : null,
    }
  }, [currentIndex, currentTrack?.id, playMode, playlist, playlistComplete, shufflePlan])

  const goTo = useCallback((index: number | null, autoplay: boolean, startTime?: number) => {
    if (index == null) {
      currentIndexRef.current = null
      pendingSeekRef.current = null
      setCurrentIndex(null)
      return
    }
    const audio = ensureSingletonAudio()
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
          void audio.play().catch(() => {})
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
    const go = () => {
      const list = playlistRef.current
      const curr = currentIndexRef.current
      const mode = playModeRef.current
      const plan = shufflePlanRef.current
      if (mode === 'shuffle' && curr != null && plan.forIndex === curr && plan.forLen === list.length) {
        const planned = direction === 1 ? plan.next : plan.prev
        if (planned != null && list[planned]) {
          goTo(planned, true)
          return
        }
      }
      goTo(getAdjacentIndex(list, curr, mode, direction), true)
    }
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
    requestMusicPlaylistSync()
    resetCircuitBreaker()
    const idx = currentIndexRef.current
    const track = idx == null ? null : playlistRef.current[idx] ?? null
    if (!track) {
      pendingPlayRef.current = true
      return
    }
    const wasTripped = circuitTrippedRef.current
    if (wasTripped || (audio.error && audio.error.code !== MEDIA_ERR_ABORTED)) {
      circuitTrippedRef.current = false
      resetTrackPlayStats()
      const time = audio.currentTime
      if (!wasTripped && prevTrackIdRef.current != null && time > 0 && !pendingSeekRef.current)
        pendingSeekRef.current = { trackId: prevTrackIdRef.current, time }
      audio.load()
    }
    void audio.play().catch(() => {})
  }, [resetCircuitBreaker, resetTrackPlayStats])

  // 统一通过 audio 事件驱动上下文状态（isPlaying / time / duration）
  useEffect(() => {
    const audio = ensureSingletonAudio()
    if (!audio)
      return

    const onPlay = () => {
      hasPlayedRef.current = true
      requestMusicPlaylistSync()
      setHasPlayed(true)
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
        void audio.play().catch(() => {})
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

    const actuallyPlaying = !audio.paused && !audio.ended
    setIsPlaying(actuallyPlaying)
    if (actuallyPlaying) {
      hasPlayedRef.current = true
      requestMusicPlaylistSync()
      setHasPlayed(true)
      playingSinceRef.current ??= performance.now()
    }
    else if (hasPlayedRef.current) {
      setHasPlayed(true)
    }
    if (audio.readyState >= 1 || (Number.isFinite(audio.duration) && audio.duration > 0))
      onLoaded()
    else if (audio.currentTime > 0 && Number.isFinite(audio.currentTime))
      clock.set(audio.currentTime)
    if (audio.ended && prevTrackIdRef.current != null && !circuitTrippedRef.current)
      onEnded()

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

  // 当前曲目的歌词引擎（有曲目时才加载）
  const lyricsEngine = useLazyModule(loadLyricsEngine, currentTrackId != null)
  const [lyricsState, setLyricsState] = useState<MusicLyricsState>(EMPTY_MUSIC_LYRICS_STATE)
  const lyrics = lyricsState.lyrics
  const refreshLyrics = useCallback(() => {
    const id = playlistRef.current[currentIndexRef.current ?? -1]?.id
    if (id != null)
      void import('./song-lyrics').then(({ refreshSongLyrics }) => refreshSongLyrics(id), () => {})
  }, [])

  const lyricAnnotationsGenerating = lyricsState.annotationsGenerating
  const lyricAnnotated = lyricsState.annotated
  const lyricAiTranslated = lyricsState.aiTranslated
  const lyricTranslationsGenerating = lyricsState.translationsGenerating
  const lyricCanAiTranslate = lyricsState.canAiTranslate
  const effectiveTranslationLang = lyricsState.effectiveTranslationLang
  const availableTranslationLangs = lyricsState.availableTranslationLangs
  const lyricAiRomanized = lyricsState.aiRomanized
  const lyricPronunciationsGenerating = lyricsState.pronunciationsGenerating
  const lyricCanAiPronounce = lyricsState.canAiPronounce

  useEffect(() => {
    setTranslationRequested(false)
    setRomajiRequested(false)
  }, [currentTrackId])

  const lyricCandidates = lyricsState.candidates
  const lyricKind = lyricsState.kind
  const lyricSiteKind = lyricsState.siteKind
  const lyricIsSiteVersion = lyricsState.isSiteVersion
  const lyricsPending = lyricsState.pending
  const lyricStatus = lyricsState.status

  // 相邻一首曲目空闲预热
  useEffect(() => {
    const audio = audioRef.current
    if (!currentTrack || !audio)
      return
    let cancelScheduled: (() => void) | null = null
    let disposed = false

    const tryPreload = () => {
      if (disposed || audio.paused || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA)
        return
      if (deferredPlaylistRef.current) {
        void ensurePlaylist()
        return
      }
      if (document.visibilityState !== 'visible')
        return
      if (lyricStatus === 'loading' || lyricsPending)
        return
      if (!adjacentTracks.next && !adjacentTracks.prev)
        return
      cancelScheduled?.()
      void loadAdjacentPreloader().then(({ scheduleAdjacentTrackPreload }) => {
        if (!disposed)
          cancelScheduled = scheduleAdjacentTrackPreload(adjacentTracks)
      }, () => {})
    }

    tryPreload()
    audio.addEventListener('playing', tryPreload)
    audio.addEventListener('canplaythrough', tryPreload)
    document.addEventListener('visibilitychange', tryPreload)
    return () => {
      disposed = true
      cancelScheduled?.()
      audio.removeEventListener('playing', tryPreload)
      audio.removeEventListener('canplaythrough', tryPreload)
      document.removeEventListener('visibilitychange', tryPreload)
    }
  }, [adjacentTracks, currentTrack, ensurePlaylist, lyricStatus, lyricsPending])

  const sameTrackState = lyricsState.trackId === currentTrackId
  const songLang = sameTrackState ? lyricsState.songLang : null
  const activePronunciationBucket: PronunciationLangBucket | null = sameTrackState ? lyricsState.pronunciationBucket : null
  const activeTranslationBucket: TranslationSongBucket | null = sameTrackState ? lyricsState.translationBucket : null
  const targetLangRef = useRef(targetLang)
  const pronunciationBucketRef = useRef(activePronunciationBucket)
  const translationBucketRef = useRef(activeTranslationBucket)
  useEffect(() => {
    targetLangRef.current = targetLang
    pronunciationBucketRef.current = activePronunciationBucket
    translationBucketRef.current = activeTranslationBucket
  }, [activePronunciationBucket, activeTranslationBucket, targetLang])

  const showRomaji = useMemo(
    () => resolvePronunciationEnabled(pronunciationPrefs, targetLang, activePronunciationBucket, defaultShowRomaji),
    [activePronunciationBucket, defaultShowRomaji, pronunciationPrefs, targetLang],
  )
  const showTranslation = useMemo(
    () => resolveTranslationEnabled(
      translationPrefs,
      translationSelectionsByBucket,
      targetLang,
      activeTranslationBucket,
      defaultShowTranslation,
    ),
    [activeTranslationBucket, defaultShowTranslation, targetLang, translationPrefs, translationSelectionsByBucket],
  )
  const translationSelections = useMemo(
    () => resolveBucketSelections(
      translationSelectionsByBucket,
      targetLang,
      activeTranslationBucket,
      defaultTranslationSelections,
    ),
    [activeTranslationBucket, defaultTranslationSelections, targetLang, translationSelectionsByBucket],
  )
  const translationLang = translationSelections[0]?.lang ?? null
  const preferNativeTranslation = Boolean(translationSelections[0]?.preferNative)

  const lyricLines = useMemo(() => getVocalLyricLines(lyrics.lines), [lyrics.lines])
  useEffect(() => {
    const update = () => lyricCursor.set(lyricLines.length === 0
      ? null
      : findActiveLyricLineIndex(lyricLines, clock.getSnapshot() * 1000, null))
    update()
    return clock.subscribe(update)
  }, [clock, lyricCursor, lyricLines])

  const replacePlaylist = useCallback((tracks: MusicTrack[], startIndex = 0, startTime?: number) => {
    supersedeSteps()
    resetCircuitBreaker()
    circuitTrippedRef.current = false
    const index = tracks.length > 0 ? Math.max(0, Math.min(startIndex, tracks.length - 1)) : null
    const track = index == null ? null : tracks[index]
    pendingSeekRef.current = track && startTime != null && Number.isFinite(startTime) && startTime > 0
      ? { trackId: track.id, time: startTime }
      : null
    const audio = ensureSingletonAudio()
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
    playlistStateRef.current = 'loaded'
    setPlaylist(tracks)
    setCurrentIndex(index)
    setPlaylistState('loaded')
  }, [resetCircuitBreaker, supersedeSteps])

  const playTrack = useCallback((index: number, startTime?: number) => {
    requestMusicPlaylistSync()
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
      const audio = ensureSingletonAudio()
      if (audio)
        startAudio(audio)
      return
    }
    goTo(index, true)
  }, [goTo, resetCircuitBreaker, startAudio, supersedeSteps])

  const playSong = useCallback((track: MusicTrack, startTime?: number) => {
    requestMusicPlaylistSync()
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
    requestMusicPlaylistSync()
    const audio = ensureSingletonAudio()
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
    const audio = ensureSingletonAudio()
    if (!audio)
      return
    if (audio.paused) {
      requestMusicPlaylistSync()
      startAudio(audio)
    }
    else {
      audio.pause()
    }
  }, [startAudio])

  const next = useCallback(() => {
    requestMusicPlaylistSync()
    resetCircuitBreaker()
    circuitTrippedRef.current = false
    step(1)
  }, [resetCircuitBreaker, step])

  const prev = useCallback(() => {
    requestMusicPlaylistSync()
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
    catch { }
  }, [clock])

  const setVolume = useCallback((v: number) => {
    const audio = audioRef.current
    const nextVolume = Math.max(0, Math.min(1, v))
    volumeRef.current = nextVolume
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
      volumeRef.current = nextVolume
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
      isMutedRef.current = nextMuted
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
    playModeRef.current = mode
    setPlayModeState(mode)
    writeStored(STORAGE_KEY_PLAY_MODE, mode)
  }, [])

  const setShowTranslation = useCallback((show: boolean) => {
    if (show)
      setTranslationRequested(true)
    const bucket = translationBucketRef.current
    const lang = targetLangRef.current
    if (bucket != null) {
      const key = `${lang}:${bucket}`
      setTranslationPrefs((prev) => {
        const nextMap = { ...prev, [key]: show }
        writeStored(STORAGE_KEY_TRANSLATION_PREFS, nextMap)
        return nextMap
      })
      return
    }
    setDefaultShowTranslation(show)
    writeStored(STORAGE_KEY_SHOW_TRANSLATION, show)
  }, [])

  const setTranslationSelections = useCallback((selections: LyricTranslationSelection[]) => {
    const nextSelections = normalizeStoredSelections(selections)
    if (nextSelections.length > 0)
      setTranslationRequested(true)
    const bucket = translationBucketRef.current
    const lang = targetLangRef.current
    if (bucket != null) {
      const key = `${lang}:${bucket}`
      setTranslationSelectionsByBucket((prev) => {
        const updated = { ...prev, [key]: nextSelections }
        writeStored(STORAGE_KEY_TRANSLATION_SELECTIONS_BY_BUCKET, updated)
        return updated
      })
      return
    }
    setDefaultTranslationSelections(nextSelections)
    try {
      if (nextSelections.length === 0) {
        localStorage.removeItem(STORAGE_KEY_TRANSLATION_SELECTIONS)
        localStorage.removeItem(STORAGE_KEY_TRANSLATION_LANG)
        localStorage.removeItem(STORAGE_KEY_TRANSLATION_PREFER_NATIVE)
      }
      else {
        localStorage.setItem(STORAGE_KEY_TRANSLATION_SELECTIONS, JSON.stringify(nextSelections))
        localStorage.setItem(STORAGE_KEY_TRANSLATION_LANG, JSON.stringify(nextSelections[0].lang))
        if (nextSelections[0].preferNative)
          localStorage.setItem(STORAGE_KEY_TRANSLATION_PREFER_NATIVE, JSON.stringify(true))
        else
          localStorage.removeItem(STORAGE_KEY_TRANSLATION_PREFER_NATIVE)
      }
    }
    catch { }
  }, [])

  const setTranslationLang = useCallback((lang: LyricTargetLang | null, preferNative = false) => {
    if (lang == null) {
      setTranslationSelections([])
      return
    }
    setTranslationSelections([{ lang, preferNative: Boolean(preferNative) }])
  }, [setTranslationSelections])

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
    if (show)
      setRomajiRequested(true)
    const bucket = pronunciationBucketRef.current
    const lang = targetLangRef.current
    if (bucket != null) {
      const key = `${lang}:${bucket}`
      setPronunciationPrefs((prev) => {
        const nextMap = { ...prev, [key]: show }
        writeStored(STORAGE_KEY_PRONUNCIATION_PREFS, nextMap)
        return nextMap
      })
      return
    }
    setDefaultShowRomaji(show)
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
    catch { }

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

  const hasTranslationLyric = useMemo(() => lyrics.lines.some(line => Boolean(line.translation || line.secondaryTranslation)), [lyrics])
  const canToggleTranslation = hasTranslationLyric || lyricCanAiTranslate || availableTranslationLangs.some(item => item.hasAi || item.hasNative || item.generating)
  const hasRomajiLyric = useMemo(() => lyrics.lines.some(line => Boolean(line.romanization)), [lyrics])
  const hasRomajiCandidate = sameTrackState && lyricsState.hasRomajiCandidate
  const canToggleRomaji = hasRomajiLyric || hasRomajiCandidate || lyricCanAiPronounce

  const runtimeActions = useMemo<MusicActionsValue>(() => ({
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

  const playbackSnapshot = useMemo<MusicPlaybackValue>(() => ({
    playlist,
    currentIndex,
    currentTrack,
    isPlaying,
    hasPlayed,
    playMode,
    duration,
    playlistComplete,
    playlistLoading,
    pendingStep,
    playlistState,
    adjacentTracks,
  }), [
    playlist,
    currentIndex,
    currentTrack,
    isPlaying,
    hasPlayed,
    playMode,
    duration,
    playlistComplete,
    playlistLoading,
    pendingStep,
    playlistState,
    adjacentTracks,
  ])

  const volumeSnapshot = useMemo<RuntimeVolumeSnapshot>(() => ({
    volume,
    isMuted,
  }), [volume, isMuted])

  const preferencesSnapshot = useMemo<RuntimePreferencesSnapshot>(() => ({
    showTranslation,
    translationLang,
    preferNativeTranslation,
    translationSelections,
    showRomaji,
    showLyricEffects,
    showLyricMoments,
    hdr,
  }), [
    showTranslation,
    translationLang,
    preferNativeTranslation,
    translationSelections,
    showRomaji,
    showLyricEffects,
    showLyricMoments,
    hdr,
  ])

  const lyricsSnapshot = useMemo<RuntimeLyricsSnapshot>(() => ({
    lyricLines,
    lyricStatus,
    lyrics,
    lyricCandidates,
    lyricKind,
    lyricSiteKind,
    lyricIsSiteVersion,
    lyricSourcesPending: lyricsPending,
    lyricAnnotated,
    lyricAnnotationsGenerating,
    hasTranslationLyric,
    canToggleTranslation,
    lyricAiTranslated,
    lyricTranslationsGenerating,
    effectiveTranslationLang,
    songLang,
    availableTranslationLangs,
    hasRomajiLyric,
    canToggleRomaji,
    lyricAiRomanized,
    lyricPronunciationsGenerating,
  }), [
    lyricLines,
    lyricStatus,
    lyrics,
    lyricCandidates,
    lyricKind,
    lyricSiteKind,
    lyricIsSiteVersion,
    lyricsPending,
    lyricAnnotated,
    lyricAnnotationsGenerating,
    hasTranslationLyric,
    canToggleTranslation,
    lyricAiTranslated,
    lyricTranslationsGenerating,
    effectiveTranslationLang,
    songLang,
    availableTranslationLangs,
    hasRomajiLyric,
    canToggleRomaji,
    lyricAiRomanized,
    lyricPronunciationsGenerating,
  ])

  // 注册实时动作委托并回放 chunk 加载期间积压的操作指令
  useLayoutEffect(() => {
    sharedSession.runtimeActions = runtimeActions
    if (sharedSession.queuedCommands.length > 0) {
      const pending = sharedSession.queuedCommands.splice(0, sharedSession.queuedCommands.length)
      for (const cmd of pending) {
        switch (cmd.type) {
          case 'next':
            runtimeActions.next()
            break
          case 'prev':
            runtimeActions.prev()
            break
          case 'ensurePlaylist':
            void runtimeActions.ensurePlaylist().then(cmd.resolve)
            break
          case 'setShowTranslation':
            runtimeActions.setShowTranslation(cmd.show)
            break
          case 'setTranslationLang':
            runtimeActions.setTranslationLang(cmd.lang, cmd.preferNative)
            break
          case 'setTranslationSelections':
            runtimeActions.setTranslationSelections(cmd.selections)
            break
          case 'setShowRomaji':
            runtimeActions.setShowRomaji(cmd.show)
            break
          case 'setShowLyricEffects':
            runtimeActions.setShowLyricEffects(cmd.show)
            break
          case 'setShowLyricMoments':
            runtimeActions.setShowLyricMoments(cmd.show)
            break
          case 'setHdr':
            runtimeActions.setHdr(cmd.enabled)
            break
          case 'refreshLyrics':
            runtimeActions.refreshLyrics()
            break
        }
      }
    }
    return () => {
      if (sharedSession.runtimeActions === runtimeActions)
        sharedSession.runtimeActions = null
    }
  }, [runtimeActions])

  useLayoutEffect(() => {
    onPlaybackChange(playbackSnapshot)
  }, [onPlaybackChange, playbackSnapshot])

  useLayoutEffect(() => {
    onVolumeChange(volumeSnapshot)
  }, [onVolumeChange, volumeSnapshot])

  useLayoutEffect(() => {
    onPreferencesChange(preferencesSnapshot)
  }, [onPreferencesChange, preferencesSnapshot])

  useLayoutEffect(() => {
    onLyricsChange(lyricsSnapshot)
  }, [lyricsSnapshot, onLyricsChange])

  if (!lyricsEngine)
    return null

  return (
    <lyricsEngine.MusicLyricsEngine
      trackId={currentTrackId}
      track={currentTrack}
      isPlaying={isPlaying}
      showLyricEffects={showLyricEffects}
      showLyricMoments={showLyricMoments}
      showTranslation={showTranslation}
      translationLang={translationLang}
      preferNativeTranslation={preferNativeTranslation}
      translationSelections={translationSelections}
      translationPrefs={translationPrefs}
      defaultShowTranslation={defaultShowTranslation}
      translationSelectionsByBucket={translationSelectionsByBucket}
      defaultTranslationSelections={defaultTranslationSelections}
      translationRequested={translationRequested}
      showRomaji={showRomaji}
      pronunciationPrefs={pronunciationPrefs}
      defaultShowRomaji={defaultShowRomaji}
      romajiRequested={romajiRequested}
      onChange={setLyricsState}
    />
  )
}
