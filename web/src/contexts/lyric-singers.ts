'use client'

import type { SiteLyricSingers } from '@/lib/lyrics/apply-singers'
import type { LyricTargetLang } from '@/lib/lyrics/target-lang'
import type { LyricSource } from '@/lib/lyrics/types'
import { isAxiosError } from 'axios'
import { useSyncExternalStore } from 'react'
import { fetchLyricSingers, refreshLyricSingers } from '@/api/music'

const POLL_MS = 2000
const MAX_POLLS = 60

function pollDelayMs(polls: number): number {
  return polls <= 1 ? 800 : polls === 2 ? 1200 : POLL_MS
}

interface CacheEntry {
  data: SiteLyricSingers | null
  generating: boolean
}

const EMPTY_ENTRY: CacheEntry = { data: null, generating: false }
const cache = new Map<string, CacheEntry>()
// 仅按 id + source 保存最新就绪声部数据，供翻译开关关闭（lang === ''）时无闪烁回退读取
const baseCache = new Map<string, CacheEntry>()
const inFlight = new Set<string>()
const pollCounts = new Map<string, number>()
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()

function cacheKey(id: number, source: string, lang: string): string {
  return `${id}:${source}:${lang}`
}

function baseKey(id: number, source: string): string {
  return `${id}:${source}`
}

function emit() {
  for (const listener of listeners) listener()
}

function setEntry(key: string, id: number, source: string, next: CacheEntry) {
  const prev = cache.get(key)
  if (next.data)
    baseCache.set(baseKey(id, source), { data: next.data, generating: false })
  if (prev && prev.data === next.data && prev.generating === next.generating)
    return
  cache.set(key, next)
  emit()
}

function clearRetry(key: string) {
  const timer = retryTimers.get(key)
  if (timer) {
    clearTimeout(timer)
    retryTimers.delete(key)
  }
  pollCounts.delete(key)
}

function schedulePoll(id: number, source: string, lang: LyricTargetLang | '') {
  const key = cacheKey(id, source, lang)
  if (retryTimers.has(key))
    return
  const nextCount = (pollCounts.get(key) ?? 0) + 1
  if (nextCount > MAX_POLLS) {
    pollCounts.delete(key)
    const prev = cache.get(key) ?? EMPTY_ENTRY
    setEntry(key, id, source, { ...prev, generating: false })
    return
  }
  pollCounts.set(key, nextCount)
  const timer = setTimeout(() => {
    retryTimers.delete(key)
    void loadSingers(id, source, lang, true)
  }, pollDelayMs(nextCount))
  retryTimers.set(key, timer)
}

async function loadSingers(id: number, source: string, lang: LyricTargetLang | '', force = false): Promise<void> {
  if (!Number.isFinite(id) || id <= 0 || !source || source === 'none')
    return
  const key = cacheKey(id, source, lang)
  if (inFlight.has(key))
    return
  if (!force && cache.has(key)) {
    const existing = cache.get(key)
    if (!existing?.generating)
      return
  }

  inFlight.add(key)
  try {
    const res = await fetchLyricSingers(id, source as LyricSource, lang || undefined)
    if (!res) {
      clearRetry(key)
      const prev = cache.get(key)
      setEntry(key, id, source, { data: prev?.data ?? null, generating: false })
      return
    }
    const generating = res.status === 'pending' || Boolean(res.stale) || Boolean(res.translationPending)
    const prev = cache.get(key)
    setEntry(key, id, source, {
      data: res.status === 'ready' ? res : (prev?.data ?? null),
      generating,
    })
    if (generating)
      schedulePoll(id, source, lang)
    else
      clearRetry(key)
  }
  catch {
    clearRetry(key)
    const prev = cache.get(key)
    setEntry(key, id, source, { data: prev?.data ?? null, generating: false })
  }
  finally {
    inFlight.delete(key)
  }
}

export function requestLyricSingers(
  id: number | null,
  source: string | null | undefined,
  lang: LyricTargetLang | '' = '',
) {
  if (id == null || id <= 0 || !source || source === 'none')
    return
  void loadSingers(id, source, lang, false)
}

/** 管理员手动重新生成指定词源的演唱者 / 声部标注，或仅刷新当前语言歌手译名 */
export async function refreshSingers(
  id: number,
  source: string,
  lang: LyricTargetLang | '' = '',
  translateOnly = false,
): Promise<'started' | 'unavailable'> {
  if (!Number.isFinite(id) || id <= 0 || !source || source === 'none')
    return 'unavailable'
  const key = cacheKey(id, source, lang)
  clearRetry(key)
  try {
    const res = await refreshLyricSingers(id, source as LyricSource, lang || undefined, translateOnly)
    const generating = res.status === 'pending' || Boolean(res.stale) || Boolean(res.translationPending)
    const prev = cache.get(key)
    setEntry(key, id, source, {
      data: res.status === 'ready' ? res : (prev?.data ?? null),
      generating,
    })
    if (generating)
      schedulePoll(id, source, lang)
    return 'started'
  }
  catch (error) {
    const status = isAxiosError(error) ? error.response?.status : undefined
    if (status === 404 || status === 400) {
      const prev = cache.get(key)
      setEntry(key, id, source, { data: prev?.data ?? null, generating: false })
      return 'unavailable'
    }
    throw error
  }
}

function getEntry(id: number | null, source: string | null | undefined, lang: LyricTargetLang | ''): CacheEntry {
  if (id == null || id <= 0 || !source || source === 'none')
    return EMPTY_ENTRY
  const exact = cache.get(cacheKey(id, source, lang))
  if (exact)
    return exact
  if (lang === '')
    return baseCache.get(baseKey(id, source)) ?? EMPTY_ENTRY
  return EMPTY_ENTRY
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLyricSingers(
  id: number | null,
  source: string | null | undefined,
  lang: LyricTargetLang | '' = '',
): SiteLyricSingers | null {
  return useSyncExternalStore(
    subscribe,
    () => getEntry(id, source, lang).data,
    () => null,
  )
}

export function useLyricSingersGenerating(
  id: number | null,
  source: string | null | undefined,
  lang: LyricTargetLang | '' = '',
): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getEntry(id, source, lang).generating,
    () => false,
  )
}
