'use client'

import type { MusicChorus } from '@/api/music'
import { useCallback, useSyncExternalStore } from 'react'
import { fetchSongChorus } from '@/api/music'

/**
 * 网易云标出的副歌 / 高潮片段（spec 7.2g）：按歌曲 id 在本页内缓存，每首歌只请求一次；失败或没有时为空数组
 */

interface Entry {
  chorus: MusicChorus[]
  listeners: Set<() => void>
  started: boolean
}

const EMPTY: MusicChorus[] = []
const entries = new Map<number, Entry>()

export function useSongChorus(id: number | null): MusicChorus[] {
  const valid = id != null && id > 0
  const subscribe = useCallback((listener: () => void) => {
    if (!valid)
      return () => {}
    let entry = entries.get(id)
    if (!entry) {
      entry = { chorus: EMPTY, listeners: new Set(), started: false }
      entries.set(id, entry)
    }
    entry.listeners.add(listener)
    if (!entry.started) {
      entry.started = true
      const current = entry
      fetchSongChorus(id).then((chorus) => {
        current.chorus = chorus
        current.listeners.forEach(fn => fn())
      }, () => {})
    }
    return () => {
      entries.get(id)?.listeners.delete(listener)
    }
  }, [id, valid])
  return useSyncExternalStore(subscribe, () => (valid ? entries.get(id)?.chorus ?? EMPTY : EMPTY), () => EMPTY)
}
