'use client'

import type { MusicTrack } from '@/models/music'
import { fetchSongAudioURL } from '@/api/music'
import { preloadSongMvInfo, warmMvStreamMetadata } from '@/components/music-page/use-mv-sync'
import { loadCoverAccent } from '@/lib/lyrics/cover-color'
import { formatMusicCoverUrl } from '@/utils/common/image'
import { PREFETCH_TTL_MS, shouldPrefetch } from './music-context'
import { preloadSongChorus } from './song-chorus'
import { loadSongLyrics } from './song-lyrics'

const prefetchedAudioAt = new Map<number, number>()
const warmedCoverUrls = new Set<string>()

function isDataSaverActive(): boolean {
  if (typeof navigator === 'undefined')
    return false
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean, effectiveType?: string }
  }).connection
  if (!conn)
    return false
  return Boolean(conn.saveData || conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g')
}

function scheduleIdle(task: () => void, fallbackDelayMs: number): () => void {
  if (typeof window === 'undefined')
    return () => {}
  let idleId = 0
  const timer = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(() => task(), { timeout: 2500 })
    }
    else {
      task()
    }
  }, fallbackDelayMs)
  return () => {
    window.clearTimeout(timer)
    if (idleId && typeof window.cancelIdleCallback === 'function')
      window.cancelIdleCallback(idleId)
  }
}

function warmImageUrl(url: string) {
  if (!url || warmedCoverUrls.has(url) || typeof Image === 'undefined')
    return
  warmedCoverUrls.add(url)
  if (warmedCoverUrls.size > 120) {
    const first = warmedCoverUrls.values().next().value
    if (first)
      warmedCoverUrls.delete(first)
  }
  const img = new Image()
  img.decoding = 'async'
  img.src = url
}

function preloadSingleNeighbor(track: MusicTrack, warmVideoStream: boolean) {
  if (!track || track.id <= 0)
    return

  const now = Date.now()
  if (shouldPrefetch(prefetchedAudioAt, track.id, now)) {
    prefetchedAudioAt.set(track.id, now)
    fetchSongAudioURL(track.id).catch(() => {
      if (Date.now() - now < PREFETCH_TTL_MS)
        prefetchedAudioAt.delete(track.id)
    })
  }

  // 预热全源歌词与副歌高潮区间（纯只读接口与缓存快照，绝不触发未播放曲目的 AI 大模型生成）
  loadSongLyrics(track.id)
  preloadSongChorus(track.id)

  // 预热封面主色（48px）与小窗/背景/全屏播放器封面缩略图（240px / 256px / 400px）
  if (track.albumPic) {
    void loadCoverAccent(track.albumPic)
    warmImageUrl(formatMusicCoverUrl(track.albumPic, 240))
    warmImageUrl(formatMusicCoverUrl(track.albumPic, 256))
    warmImageUrl(formatMusicCoverUrl(track.albumPic, 400))
  }

  // 预热 MV 元数据，并为下一首曲目轻量预热 MP4 moov 容器头（preload="metadata"）
  void preloadSongMvInfo(track.id).then((mv) => {
    if (warmVideoStream && mv?.available && mv.streamUrl && !mv.disabled)
      warmMvStreamMetadata(mv.streamUrl)
  })
}

/**
 * 在当前歌曲音频缓冲充裕且自身歌词已就绪后，利用浏览器空闲时间分批预热「下一首」与「上一首」的音频地址、歌词、副歌、封面及 MV：
 * - 按需动态 import，0 字节进入任何页面的首屏包；
 * - 未播放音乐或开启系统省流量模式时完全静默；
 * - 先预热下一首（+500ms 空闲），再错峰预热上一首（+1100ms 空闲），绝不与当前曲目争抢带宽或主线程。
 */
export function scheduleAdjacentTrackPreload(neighbors: {
  next: MusicTrack | null
  prev: MusicTrack | null
}): () => void {
  if (isDataSaverActive())
    return () => {}

  const cancels: (() => void)[] = []
  const { next, prev } = neighbors
  if (next) {
    cancels.push(scheduleIdle(() => preloadSingleNeighbor(next, true), 500))
  }
  if (prev && prev.id !== next?.id) {
    cancels.push(scheduleIdle(() => preloadSingleNeighbor(prev, false), 1100))
  }
  return () => {
    for (const cancel of cancels)
      cancel()
  }
}
