'use client'

import { useEffect, useRef, useState } from 'react'
import { useMusic, useMusicClockStore } from '@/contexts/music-context'
import { buildMusicShareSearch, parseMusicShareParams } from './music-share-params'

// 播放中写地址的最短间隔；停下后最后一次进度仍会写入
const URL_SYNC_INTERVAL_MS = 1000
// 已在播放这首歌时，进度与 start 相差超过此值（秒）才跳转
const SEEK_TOLERANCE_S = 1

/**
 * 播放器页的分享地址（/music?id=…&start=…，见 spec 5.6）：
 * - 打开或站内跳转到带参数的地址时定位到该曲目与进度（刷新后的首次加载已由悬浮播放器的恢复逻辑处理）；
 *   歌曲不在歌单内时忽略参数，仍按本地存储恢复
 * - 之后实时把当前曲目与进度写进地址（replaceState，不产生历史记录），方便复制分享
 */
export function useMusicShareUrl() {
  const { playlist, currentTrack, replacePlaylist, seek } = useMusic()
  const clock = useMusicClockStore()
  const appliedRef = useRef(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (appliedRef.current || playlist.length === 0)
      return
    appliedRef.current = true
    const shared = parseMusicShareParams(window.location.search)
    const index = shared.id == null ? -1 : playlist.findIndex(track => track.id === shared.id)
    if (index >= 0) {
      if (currentTrack?.id !== shared.id)
        replacePlaylist(playlist, index, shared.start ?? 0)
      else if (shared.start != null && Math.abs(clock.getSnapshot() - shared.start) > SEEK_TOLERANCE_S)
        seek(shared.start)
    }
    setReady(true)
  }, [clock, currentTrack?.id, playlist, replacePlaylist, seek])

  const trackId = currentTrack?.id ?? null
  useEffect(() => {
    // 参数应用之前不写地址，避免把分享的曲目覆盖成之前在播放的曲目；示例曲目（id 为 0）不写
    if (!ready || trackId == null || trackId <= 0)
      return
    let lastSearch = ''
    let lastAt = Number.NEGATIVE_INFINITY
    let timer: number | undefined
    const write = () => {
      timer = undefined
      const search = buildMusicShareSearch(window.location.search, trackId, clock.getSnapshot())
      lastAt = performance.now()
      if (search === lastSearch || search === window.location.search) {
        lastSearch = search
        return
      }
      lastSearch = search
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
    }
    const schedule = () => {
      if (timer != null)
        return
      const wait = URL_SYNC_INTERVAL_MS - (performance.now() - lastAt)
      if (wait <= 0)
        write()
      else
        timer = window.setTimeout(write, wait)
    }
    write()
    const unsubscribe = clock.subscribe(schedule)
    return () => {
      unsubscribe()
      if (timer != null)
        window.clearTimeout(timer)
    }
  }, [clock, ready, trackId])
}
