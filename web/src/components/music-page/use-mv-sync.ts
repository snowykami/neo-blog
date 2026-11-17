'use client'

import type { MusicSongMV } from '@/models/music'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSongMV, saveSongMVSetting } from '@/api/music'

export const MIN_MV_OFFSET_MS = -60000
export const MAX_MV_OFFSET_MS = 180000
export const MV_DRIFT_CHECK_INTERVAL_MS = 750
export const MV_DRIFT_IGNORE_SEC = 0.25
export const MV_DRIFT_SEEK_SEC = 1.5

export type MvDriftAction
  = | { kind: 'none', playbackRate: 1 }
    | { kind: 'rate', playbackRate: number }
    | { kind: 'seek', targetTime: number, playbackRate: 1 }

/** 限制 MV 偏移在后端允许的 [-60000, 180000] 毫秒范围内 */
export function clampMvOffsetMs(offsetMs: number): number {
  if (!Number.isFinite(offsetMs))
    return 0
  return Math.max(MIN_MV_OFFSET_MS, Math.min(MAX_MV_OFFSET_MS, Math.round(offsetMs)))
}

/** MV 同步目标时间（秒）：正数跳过 MV 片头，负数延后开始 */
export function computeTargetVideoTime(audioCurrentTime: number, offsetMs: number): number {
  const base = Number.isFinite(audioCurrentTime) ? audioCurrentTime : 0
  return base + offsetMs / 1000
}

/** 判断目标时间是否落在视频有效时间轴 [0, duration) 内 */
export function isTargetVideoTimeInBounds(targetTime: number, videoDuration: number): boolean {
  if (!Number.isFinite(targetTime) || targetTime < 0)
    return false
  if (Number.isFinite(videoDuration) && videoDuration > 0 && targetTime >= videoDuration)
    return false
  return true
}

/**
 * 播放中防漂移纠偏策略：
 * - |drift| < 0.25s：忽略，恢复原速 1x
 * - 0.25s <= |drift| < 1.5s：微调 playbackRate 平滑追赶
 * - |drift| >= 1.5s：直接 seek 到目标位置并恢复 1x
 */
export function computeDriftCorrection(targetTime: number, currentVideoTime: number): MvDriftAction {
  const drift = targetTime - currentVideoTime
  const absDrift = Math.abs(drift)
  if (!Number.isFinite(drift) || absDrift < MV_DRIFT_IGNORE_SEC)
    return { kind: 'none', playbackRate: 1 }
  if (absDrift >= MV_DRIFT_SEEK_SEC)
    return { kind: 'seek', targetTime, playbackRate: 1 }
  const delta = Math.min(0.12, Math.max(0.04, absDrift * 0.12))
  const rate = Number((1 + (drift > 0 ? delta : -delta)).toFixed(3))
  return { kind: 'rate', playbackRate: rate }
}

/** 格式化毫秒偏移为带符号秒数（如 +1.2s、-0.3s、0.0s） */
export function formatMvOffset(offsetMs: number): string {
  const seconds = (offsetMs / 1000).toFixed(1)
  return offsetMs > 0 ? `+${seconds}s` : `${seconds}s`
}

// 本页会话内按歌曲 ID 缓存 MV 元数据，切换移动端封面/歌词视图或切往已预热相邻歌曲无需重复请求
const songMvCache = new Map<number, MusicSongMV | null>()
const inFlightMv = new Map<number, Promise<MusicSongMV | null>>()
const warmedStreamUrls = new Set<string>()
let warmupVideoEl: HTMLVideoElement | null = null
let warmupTimer = 0

/** 后台静默预取指定歌曲的 MV 元数据（与播放器页共享缓存与请求去重） */
export function preloadSongMvInfo(trackId: number): Promise<MusicSongMV | null> {
  if (!Number.isFinite(trackId) || trackId <= 0)
    return Promise.resolve(null)
  if (songMvCache.has(trackId))
    return Promise.resolve(songMvCache.get(trackId) ?? null)
  const existing = inFlightMv.get(trackId)
  if (existing)
    return existing
  const req = fetchSongMV(trackId)
    .then((info) => {
      songMvCache.set(trackId, info)
      return info
    }, () => {
      songMvCache.set(trackId, null)
      return null
    })
    .finally(() => {
      inFlightMv.delete(trackId)
    })
  inFlightMv.set(trackId, req)
  return req
}

/**
 * 轻量预热下一首 MV 视频流的连接与 MP4 moov 元数据（preload="metadata"，仅请求 ~256KB Range 头，不拉取整段视频）：
 * 全局严格复用单个离屏静音 <video>，元数据就绪或超时后立即释放源引用，零解码器泄漏。
 */
export function warmMvStreamMetadata(streamUrl?: string | null): void {
  if (typeof document === 'undefined' || typeof window === 'undefined' || !streamUrl)
    return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    return
  if (warmedStreamUrls.has(streamUrl))
    return
  warmedStreamUrls.add(streamUrl)
  if (warmedStreamUrls.size > 40) {
    const oldest = warmedStreamUrls.values().next().value
    if (oldest)
      warmedStreamUrls.delete(oldest)
  }

  window.clearTimeout(warmupTimer)
  if (!warmupVideoEl) {
    warmupVideoEl = document.createElement('video')
    warmupVideoEl.muted = true
    warmupVideoEl.defaultMuted = true
    warmupVideoEl.playsInline = true
    warmupVideoEl.preload = 'metadata'
  }
  const v = warmupVideoEl
  const release = () => {
    window.clearTimeout(warmupTimer)
    v.removeEventListener('loadedmetadata', release)
    v.removeEventListener('error', release)
    try {
      v.removeAttribute('src')
      v.load()
    }
    catch {}
  }
  v.addEventListener('loadedmetadata', release, { once: true })
  v.addEventListener('error', release, { once: true })
  warmupTimer = window.setTimeout(release, 8000)
  try {
    v.src = streamUrl
  }
  catch {
    release()
  }
}

interface FetchedMvEntry {
  trackId: number
  info: MusicSongMV | null
}

interface AdminDraftState {
  trackId: number
  offsetMs: number
  disabled: boolean
}

interface VideoRuntimeState {
  key: string
  canPlay: boolean
  inBounds: boolean
}

export interface UseMvSyncOptions {
  trackId: number
  getAudio: () => HTMLAudioElement | null
  isAdmin: boolean
}

export function useMvSync({ trackId, getAudio, isAdmin }: UseMvSyncOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const inBoundsRef = useRef<Record<string, boolean>>({})

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
  )
  // 读者本地手动切换「动态 MV / 静态封面」；null 时默认遵循 prefers-reduced-motion（开启减弱动态效果时默认不自动播放视频）
  const [localMvOverride, setLocalMvOverride] = useState<boolean | null>(null)
  const localMvEnabled = localMvOverride ?? !prefersReducedMotion

  const [fetched, setFetched] = useState<FetchedMvEntry | null>(() =>
    trackId > 0 && songMvCache.has(trackId)
      ? { trackId, info: songMvCache.get(trackId) ?? null }
      : null,
  )
  const mvInfo = trackId > 0
    ? (fetched?.trackId === trackId ? fetched.info : (songMvCache.get(trackId) ?? null))
    : null

  const [draft, setDraft] = useState<AdminDraftState | null>(null)
  const hasDraftForTrack = isAdmin && draft?.trackId === trackId
  const effectiveOffsetMs = hasDraftForTrack ? draft.offsetMs : (mvInfo?.offsetMs ?? 0)
  const effectiveDisabled = hasDraftForTrack ? draft.disabled : Boolean(mvInfo?.disabled)

  const [failedKey, setFailedKey] = useState('')
  const rawStreamKey = mvInfo?.available && mvInfo.streamUrl ? `${trackId}:${mvInfo.streamUrl}` : ''
  const videoFailed = rawStreamKey !== '' && failedKey === rawStreamKey

  const shouldLoadVideo = Boolean(
    trackId > 0
    && mvInfo?.available
    && mvInfo.streamUrl
    && !effectiveDisabled
    && localMvEnabled
    && !videoFailed,
  )
  const activeKey = shouldLoadVideo ? rawStreamKey : ''

  const [runtime, setRuntime] = useState<VideoRuntimeState>({ key: '', canPlay: false, inBounds: false })
  const canPlay = activeKey !== '' && runtime.key === activeKey ? runtime.canPlay : false
  const inBounds = activeKey !== '' && runtime.key === activeKey ? runtime.inBounds : false
  const videoVisible = shouldLoadVideo && canPlay && inBounds

  const [saving, setSaving] = useState(false)

  // 监听系统减弱动态效果偏好变化
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia)
      return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches)
    }
    mql.addEventListener('change', onChange)
    return () => {
      mql.removeEventListener('change', onChange)
    }
  }, [])

  // 按歌曲 ID 获取 MV 信息与偏移配置（复用预热中的请求，避免切歌瞬间重复发包）
  useEffect(() => {
    if (trackId <= 0 || songMvCache.has(trackId))
      return
    let cancelled = false
    preloadSongMvInfo(trackId).then((info) => {
      if (!cancelled)
        setFetched({ trackId, info })
    })
    return () => {
      cancelled = true
    }
  }, [trackId])

  const offsetMsRef = useRef(effectiveOffsetMs)
  offsetMsRef.current = effectiveOffsetMs
  const activeKeyRef = useRef(activeKey)
  activeKeyRef.current = activeKey

  const updateInBounds = useCallback((key: string, nextInBounds: boolean) => {
    inBoundsRef.current[key] = nextInBounds
    setRuntime((prev) => {
      const base = prev.key === key ? prev : { key, canPlay: false, inBounds: false }
      if (base.inBounds === nextInBounds && prev.key === key)
        return prev
      return { ...base, key, inBounds: nextInBounds }
    })
  }, [])

  // 核心同步函数：immediate 模式下立即对齐 currentTime，drift 模式下按阈值纠偏
  const syncVideo = useCallback((mode: 'immediate' | 'drift') => {
    const key = activeKeyRef.current
    const video = videoRef.current
    const audio = getAudio()
    if (!key || !video)
      return

    video.muted = true
    video.defaultMuted = true

    const audioTime = audio ? audio.currentTime : 0
    const targetTime = computeTargetVideoTime(audioTime, offsetMsRef.current)
    const nextInBounds = isTargetVideoTimeInBounds(targetTime, video.duration)

    if (!nextInBounds) {
      updateInBounds(key, false)
      if (!video.paused)
        video.pause()
      if (video.playbackRate !== 1)
        video.playbackRate = 1
      return
    }

    const wasOutOfBounds = inBoundsRef.current[key] === false
    updateInBounds(key, true)

    const readyToSeek = video.readyState >= HTMLMediaElement.HAVE_METADATA
    const pageVisible = typeof document === 'undefined' || document.visibilityState === 'visible'
    const shouldPlay = Boolean(audio && !audio.paused && !audio.ended && pageVisible)

    if (mode === 'immediate' || wasOutOfBounds || !shouldPlay) {
      if (readyToSeek && Math.abs(video.currentTime - targetTime) > 0.05) {
        try {
          video.currentTime = targetTime
        }
        catch { }
      }
      if (video.playbackRate !== 1)
        video.playbackRate = 1
    }
    else if (readyToSeek) {
      const action = computeDriftCorrection(targetTime, video.currentTime)
      if (action.kind === 'seek') {
        try {
          video.currentTime = action.targetTime
        }
        catch { }
        if (video.playbackRate !== 1)
          video.playbackRate = 1
      }
      else if (Math.abs(video.playbackRate - action.playbackRate) > 0.005) {
        video.playbackRate = action.playbackRate
      }
    }

    if (shouldPlay) {
      if (video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
        void video.play().catch(() => {})
    }
    else if (!video.paused) {
      video.pause()
    }
  }, [getAudio, updateInBounds])

  // 绑定 video / audio / visibilitychange 事件与定期防漂移巡检
  useEffect(() => {
    const video = videoRef.current
    if (!video)
      return
    video.muted = true
    video.defaultMuted = true

    if (!activeKey) {
      if (!video.paused)
        video.pause()
      return
    }

    const audio = getAudio()
    const onVideoCanPlay = () => {
      const audioNow = getAudio()
      const target = computeTargetVideoTime(audioNow ? audioNow.currentTime : 0, offsetMsRef.current)
      const okBounds = isTargetVideoTimeInBounds(target, video.duration)
      inBoundsRef.current[activeKey] = okBounds
      setRuntime({ key: activeKey, canPlay: true, inBounds: okBounds })
      syncVideo('immediate')
    }
    const onVideoMeta = () => syncVideo('immediate')
    const onVideoError = () => {
      if (!video.paused)
        video.pause()
      setFailedKey(activeKey)
    }
    const onAudioSync = () => syncVideo('immediate')
    const onVisibilityChange = () => syncVideo('immediate')

    video.addEventListener('loadedmetadata', onVideoMeta)
    video.addEventListener('durationchange', onVideoMeta)
    video.addEventListener('canplay', onVideoCanPlay)
    video.addEventListener('error', onVideoError)

    const audioEvents = ['play', 'playing', 'pause', 'ended', 'seeking', 'seeked', 'ratechange', 'loadedmetadata'] as const
    if (audio) {
      for (const evt of audioEvents)
        audio.addEventListener(evt, onAudioSync)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA)
      onVideoCanPlay()
    else if (video.readyState >= HTMLMediaElement.HAVE_METADATA)
      syncVideo('immediate')

    const timer = window.setInterval(() => {
      syncVideo('drift')
    }, MV_DRIFT_CHECK_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
      video.removeEventListener('loadedmetadata', onVideoMeta)
      video.removeEventListener('durationchange', onVideoMeta)
      video.removeEventListener('canplay', onVideoCanPlay)
      video.removeEventListener('error', onVideoError)
      if (audio) {
        for (const evt of audioEvents)
          audio.removeEventListener(evt, onAudioSync)
      }
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [activeKey, getAudio, syncVideo])

  // 管理员实时调整 Offset 时立即驱动画面对齐，方便对照口型/画面
  useEffect(() => {
    if (!activeKey)
      return
    syncVideo('immediate')
  }, [activeKey, effectiveOffsetMs, syncVideo])

  const adjustOffset = useCallback((nextOffsetMs: number) => {
    if (trackId <= 0)
      return
    const clamped = clampMvOffsetMs(nextOffsetMs)
    setDraft(prev => ({
      trackId,
      offsetMs: clamped,
      disabled: prev?.trackId === trackId ? prev.disabled : Boolean(mvInfo?.disabled),
    }))
  }, [mvInfo?.disabled, trackId])

  const setDisabledDraft = useCallback((nextDisabled: boolean) => {
    if (trackId <= 0)
      return
    setDraft(prev => ({
      trackId,
      offsetMs: prev?.trackId === trackId ? prev.offsetMs : (mvInfo?.offsetMs ?? 0),
      disabled: nextDisabled,
    }))
  }, [mvInfo?.offsetMs, trackId])

  const toggleLocalMv = useCallback(() => {
    setLocalMvOverride(prev => !(prev ?? !prefersReducedMotion))
  }, [prefersReducedMotion])

  const saveSetting = useCallback(async () => {
    if (trackId <= 0 || saving)
      return false
    setSaving(true)
    try {
      const updated = await saveSongMVSetting(trackId, {
        offsetMs: effectiveOffsetMs,
        disabled: effectiveDisabled,
      })
      songMvCache.set(trackId, updated)
      setFetched({ trackId, info: updated })
      setDraft(null)
      return true
    }
    catch {
      return false
    }
    finally {
      setSaving(false)
    }
  }, [effectiveDisabled, effectiveOffsetMs, saving, trackId])

  const isDirty = Boolean(
    mvInfo && (effectiveOffsetMs !== mvInfo.offsetMs || effectiveDisabled !== mvInfo.disabled),
  )

  return {
    videoRef,
    mvInfo,
    shouldLoadVideo,
    videoVisible,
    localMvEnabled,
    toggleLocalMv,
    offsetMs: effectiveOffsetMs,
    disabled: effectiveDisabled,
    adjustOffset,
    setDisabledDraft,
    saveSetting,
    saving,
    isDirty,
  }
}
