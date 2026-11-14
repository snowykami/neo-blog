'use client'

import type { LyricOutro } from '@/lib/lyrics/types'
import { useSyncExternalStore } from 'react'
import { fetchSongHotComment } from '@/api/music'

/**
 * 歌曲精选网易云热评的会话内缓存：切歌后立即与歌词、特效、翻译并行获取，
 * 用于在 AI 标注尚未完成或逐行 LRC 不走 AI 特效时也能第一时间渲染尾奏热评。
 */

interface Entry {
  value?: LyricOutro | null
  started: boolean
  listeners: Set<() => void>
}

const entries = new Map<number, Entry>()

function getEntry(id: number): Entry {
  let entry = entries.get(id)
  if (!entry) {
    entry = { started: false, listeners: new Set() }
    entries.set(id, entry)
  }
  return entry
}

function settle(entry: Entry, value: LyricOutro | null) {
  entry.value = value
  entry.listeners.forEach(listener => listener())
}

export function requestSongHotComment(id: number) {
  if (!Number.isFinite(id) || id <= 0)
    return
  const entry = getEntry(id)
  if (entry.started)
    return
  entry.started = true
  fetchSongHotComment(id).then(
    result => settle(entry, result),
    () => settle(entry, entry.value ?? null),
  )
}

export function useSongHotComment(id: number | null | undefined): LyricOutro | null {
  const validId = id != null && id > 0 ? id : null
  return useSyncExternalStore(
    (listener) => {
      if (validId == null)
        return () => {}
      const entry = getEntry(validId)
      entry.listeners.add(listener)
      return () => {
        entry.listeners.delete(listener)
      }
    },
    () => (validId == null ? null : (entries.get(validId)?.value ?? null)),
    () => null,
  )
}
