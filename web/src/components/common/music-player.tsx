'use client'

import type { MusicTrack } from '@/models/music'
import { useEffect, useRef } from 'react'
import { fetchNcmPlaylist, fetchPlaylistTrack, fetchPlaylistVersion } from '@/api/music'
import { readMusicShareParamsFromLocation } from '@/components/music-page/music-share-params'
import {
  hasStoredPlaybackRecord,
  useMusicActions,
  useMusicClockStore,
  useMusicPlayback,
} from '@/contexts/music-context'
import { readPlaylistCache, touchPlaylistCache, writePlaylistCache } from '@/lib/music-playlist-cache'

// 本地存储键：当前曲目索引、曲目 id 与播放进度（秒）
const STORAGE_KEY_INDEX = 'music-current-index'
const STORAGE_KEY_TRACK_ID = 'music-current-track-id'
const STORAGE_KEY_TIME = 'music-current-time'

function readStoredNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null)
      return null
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
  }
  catch {
    return null
  }
}

function writeStoredNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  }
  catch { }
}

/**
 * 计算刷新后应恢复的曲目索引与进度：
 * - 打开的是带分享参数的播放器页（/music?id=…&start=…）且歌曲在歌单内时，以地址为准
 * - 否则按本地存储：优先按曲目 id 定位（歌单顺序变化也不会错位）；存储的曲目已不在歌单中时从头开始且不恢复进度；
 *   兼容只存了索引的旧数据
 */
function getRestoredPlayback(tracks: MusicTrack[]): { index: number, time?: number } {
  if (tracks.length === 0)
    return { index: 0 }
  const shared = readMusicShareParamsFromLocation()
  const sharedIndex = shared ? tracks.findIndex(track => track.id === shared.id) : -1
  if (shared && sharedIndex >= 0)
    return { index: sharedIndex, time: shared.start ?? 0 }
  const storedTrackId = readStoredNumber(STORAGE_KEY_TRACK_ID)
  const storedIndex = readStoredNumber(STORAGE_KEY_INDEX)
  const storedTime = readStoredNumber(STORAGE_KEY_TIME) ?? undefined

  if (storedTrackId != null) {
    const index = tracks.findIndex(track => track.id === storedTrackId)
    return index >= 0 ? { index, time: storedTime } : { index: 0 }
  }
  if (storedIndex != null)
    return { index: Math.max(0, Math.min(Math.floor(storedIndex), tracks.length - 1)), time: storedTime }
  return { index: 0 }
}

/**
 * 恢复播放时只取一首的候选歌曲 id（按优先级）：带分享参数的播放器页里的、本地存储的上次播放的。
 * 只存了索引的旧数据返回 null：要按索引定位就得有完整歌单
 */
function getRestoreCandidates(): number[] | null {
  const ids: number[] = []
  const shared = readMusicShareParamsFromLocation()
  if (shared?.id != null)
    ids.push(shared.id)
  const storedTrackId = readStoredNumber(STORAGE_KEY_TRACK_ID)
  if (storedTrackId != null && storedTrackId > 0 && !ids.includes(storedTrackId))
    ids.push(storedTrackId)
  else if (storedTrackId == null && readStoredNumber(STORAGE_KEY_INDEX) != null)
    return null
  return ids
}

/**
 * 无头歌单同步与断点进度持久化协调器（按需挂载）：
 * 仅在存在断点续播记录、用户点击展开迷你播放器或进入 `/music` 页时挂载；
 * 若用户仅展开预览而未实际播放且未主动切歌，不向 `localStorage` 写入断点键，避免污染后续访问的静默加载判定。
 */
export function MusicPlayer() {
  const {
    currentTrack,
    currentIndex,
    duration,
    hasPlayed,
    playlistState,
  } = useMusicPlayback()
  const {
    replacePlaylist,
    updatePlaylist,
    deferPlaylist,
    markPlaylistFailed,
  } = useMusicActions()
  const clock = useMusicClockStore()

  // 记录挂载前是否已有持久化断点记录：若原本无记录且用户一直未点击播放/未切歌，则不写回 localStorage
  const hadStoredSessionRef = useRef<boolean | null>(null)
  if (hadStoredSessionRef.current == null && typeof window !== 'undefined')
    hadStoredSessionRef.current = hasStoredPlaybackRecord()

  const restoredRef = useRef(false)
  const restoredTrackIdRef = useRef<number | null>(null)
  const lastSavedTimeRef = useRef(0)
  const currentTrackId = currentTrack?.id ?? null
  const initialSessionRef = useRef({ playlistState, currentTrackId })
  initialSessionRef.current = { playlistState, currentTrackId }

  useEffect(() => {
    if (initialSessionRef.current.playlistState === 'loaded') {
      restoredTrackIdRef.current = initialSessionRef.current.currentTrackId
      restoredRef.current = true
      return
    }

    let cancelled = false
    const applyRestored = (tracks: MusicTrack[]) => {
      if (initialSessionRef.current.currentTrackId != null) {
        restoredTrackIdRef.current = initialSessionRef.current.currentTrackId
        restoredRef.current = true
        updatePlaylist(tracks)
        return
      }
      const { index, time } = getRestoredPlayback(tracks)
      restoredTrackIdRef.current = tracks[index]?.id ?? null
      restoredRef.current = true
      replacePlaylist(tracks, index, time)
    }

    const loadFull = async () => {
      const fresh = await fetchNcmPlaylist()
      writePlaylistCache(fresh.version, fresh.tracks)
      return fresh.tracks
    }

    const cached = readPlaylistCache()
    if (cached)
      applyRestored(cached.tracks)

    const sync = async () => {
      if (cached) {
        const version = await fetchPlaylistVersion()
        if (cancelled)
          return
        if (version === cached.version) {
          touchPlaylistCache(cached.version)
          return
        }
        deferPlaylist(loadFull, false)
        return
      }
      const candidates = getRestoreCandidates()
      if (candidates == null) {
        const tracks = await loadFull()
        if (!cancelled)
          applyRestored(tracks)
        return
      }
      const track = await fetchPlaylistTrack(candidates).catch(() => undefined)
      if (cancelled)
        return
      if (track === undefined) {
        const tracks = await loadFull()
        if (!cancelled)
          applyRestored(tracks)
        return
      }
      applyRestored(track ? [track] : [])
      if (track)
        deferPlaylist(loadFull, true)
    }

    sync().catch((error) => {
      if (cancelled)
        return
      if (!cached)
        markPlaylistFailed()
      console.error('Failed to fetch playlist:', error)
    })
    return () => {
      cancelled = true
    }
  }, [replacePlaylist, updatePlaylist, deferPlaylist, markPlaylistFailed])

  // 曲目变化或首次开始播放时保存索引与曲目 id；仅展开查看未播放且未切歌时不写 localStorage
  useEffect(() => {
    if (!restoredRef.current || currentTrackId == null || currentIndex == null)
      return
    const userSwitchedTrack = restoredTrackIdRef.current !== null && restoredTrackIdRef.current !== currentTrackId
    if (!hasPlayed && !hadStoredSessionRef.current && !userSwitchedTrack)
      return
    hadStoredSessionRef.current = true
    writeStoredNumber(STORAGE_KEY_INDEX, currentIndex)
    writeStoredNumber(STORAGE_KEY_TRACK_ID, currentTrackId)
    if (restoredTrackIdRef.current === currentTrackId)
      return
    restoredTrackIdRef.current = null
    writeStoredNumber(STORAGE_KEY_TIME, 0)
    lastSavedTimeRef.current = 0
  }, [currentIndex, currentTrackId, hasPlayed, playlistState])

  // 定期保存播放进度到 storage（仅在已播放或已有持久化记录后写回）
  useEffect(() => {
    if (currentTrackId == null || duration == null || (!hasPlayed && !hadStoredSessionRef.current))
      return
    return clock.subscribe(() => {
      const time = clock.getSnapshot()
      if (!restoredRef.current || !Number.isFinite(time))
        return
      const now = Date.now()
      if (now - lastSavedTimeRef.current < 1000)
        return
      writeStoredNumber(STORAGE_KEY_TIME, Math.floor(time))
      writeStoredNumber(STORAGE_KEY_TRACK_ID, currentTrackId)
      lastSavedTimeRef.current = now
    })
  }, [clock, currentTrackId, duration, hasPlayed])

  return null
}
