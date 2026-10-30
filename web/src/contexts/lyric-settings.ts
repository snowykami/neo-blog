'use client'

import type { MusicLyricVersion } from '@/api/music'
import type { LyricSourceKind } from '@/lib/lyrics/resolve'
import type { LyricSource } from '@/lib/lyrics/types'
import { useCallback, useSyncExternalStore } from 'react'
import { fetchLyricSettings, saveLyricOffset, saveLyricPin } from '@/api/music'

/**
 * 歌词的人工设置（见 spec 7.2l、7.2n）：一首歌各歌词来源的整体偏移与全站默认歌词来源，第一次用到这首歌的歌词时请求一次并缓存在本页内
 * （请求失败时视为没有设置）。管理员微调偏移时先在本地生效，停止调整 SAVE_DELAY_MS 后保存到后台；设置全站默认来源时立即保存，失败时恢复。
 * 都对所有人生效
 */

const SAVE_DELAY_MS = 600

type Offsets = Partial<Record<LyricSource, number>>

interface Entry {
  offsets: Offsets
  // 全站默认歌词来源，没有时为 null；pinTouched 为本页已由管理员修改过（以本地为准）
  pin: LyricSourceKind | null
  pinTouched: boolean
  started: boolean
  listeners: Set<() => void>
  saveTimer?: ReturnType<typeof setTimeout>
}

const EMPTY: Offsets = {}
const entries = new Map<number, Entry>()

function getEntry(id: number): Entry {
  let entry = entries.get(id)
  if (!entry) {
    entry = { offsets: EMPTY, pin: null, pinTouched: false, started: false, listeners: new Set() }
    entries.set(id, entry)
  }
  return entry
}

function notify(entry: Entry) {
  entry.listeners.forEach(listener => listener())
}

function request(id: number, entry: Entry) {
  if (entry.started)
    return
  entry.started = true
  fetchLyricSettings(id).then((settings) => {
    // 请求期间管理员已在本地调整过的来源以本地为准
    entry.offsets = { ...settings.offsets, ...entry.offsets }
    if (!entry.pinTouched)
      entry.pin = settings.pin ?? null
    notify(entry)
  }, () => {})
}

/** 订阅一首歌各歌词来源的整体偏移（毫秒）；第一次订阅时请求 */
export function useLyricOffsets(id: number | null): Offsets {
  const valid = id != null && id > 0
  const subscribe = useCallback((listener: () => void) => {
    if (!valid)
      return () => {}
    const entry = getEntry(id)
    entry.listeners.add(listener)
    request(id, entry)
    return () => {
      entry.listeners.delete(listener)
    }
  }, [id, valid])
  return useSyncExternalStore(subscribe, () => (valid ? entries.get(id)?.offsets ?? EMPTY : EMPTY), () => EMPTY)
}

/**
 * 管理员调整一首歌某一来源的偏移：立即在本地生效，停止调整后保存到后台；onSaved / onError 在保存完成或失败时调用
 */
export function setLyricOffset(id: number, source: LyricSource, offsetMs: number, callbacks?: { onSaved?: () => void, onError?: () => void }) {
  const entry = getEntry(id)
  entry.offsets = { ...entry.offsets, [source]: offsetMs }
  notify(entry)
  clearTimeout(entry.saveTimer)
  entry.saveTimer = setTimeout(() => {
    saveLyricOffset(id, source, offsetMs).then(callbacks?.onSaved, callbacks?.onError)
  }, SAVE_DELAY_MS)
}

/** 订阅一首歌的全站默认歌词来源（管理员选定），没有时为 null；第一次订阅时请求 */
export function useLyricSitePin(id: number | null): LyricSourceKind | null {
  const valid = id != null && id > 0
  const subscribe = useCallback((listener: () => void) => {
    if (!valid)
      return () => {}
    const entry = getEntry(id)
    entry.listeners.add(listener)
    request(id, entry)
    return () => {
      entry.listeners.delete(listener)
    }
  }, [id, valid])
  return useSyncExternalStore(subscribe, () => (valid ? entries.get(id)?.pin ?? null : null), () => null)
}

/**
 * 管理员设置全站默认歌词来源（null 为取消）：立即在本地生效并保存，返回后端按新设置重新选出的全站歌词版本；失败时恢复原值并抛出
 */
export async function setLyricSitePin(id: number, kind: LyricSourceKind | null): Promise<MusicLyricVersion> {
  const entry = getEntry(id)
  const previous = entry.pin
  entry.pin = kind
  entry.pinTouched = true
  notify(entry)
  try {
    return await saveLyricPin(id, kind)
  }
  catch (error) {
    entry.pin = previous
    notify(entry)
    throw error
  }
}
