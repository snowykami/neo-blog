'use client'

import type { MusicSongTranslationMeta } from '@/api/music'
import type { LyricTargetLang } from '@/lib/lyrics/target-lang'
import { isAxiosError } from 'axios'
import { useLocale } from 'next-intl'
import { useSyncExternalStore } from 'react'
import { fetchSongTranslationMeta, refreshSongTranslationMeta } from '@/api/music'
import { toLyricTargetLang } from '@/lib/lyrics/target-lang'

const POLL_MS = 2000
const MAX_POLLS = 60

function pollDelayMs(polls: number): number {
  return polls <= 1 ? 800 : polls === 2 ? 1200 : POLL_MS
}

interface CacheEntry {
  data: MusicSongTranslationMeta | null
  generating: boolean
}

const EMPTY_ENTRY: CacheEntry = { data: null, generating: false }
const cache = new Map<string, CacheEntry>()
const inFlight = new Set<string>()
const pollCounts = new Map<string, number>()
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()

function cacheKey(id: number, lang: string): string {
  return `${id}:${lang}`
}

function emit() {
  for (const listener of listeners) listener()
}

function setEntry(key: string, next: CacheEntry) {
  const prev = cache.get(key)
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

function schedulePoll(id: number, lang: LyricTargetLang) {
  const key = cacheKey(id, lang)
  if (retryTimers.has(key))
    return
  const nextCount = (pollCounts.get(key) ?? 0) + 1
  if (nextCount > MAX_POLLS) {
    pollCounts.delete(key)
    const prev = cache.get(key) ?? EMPTY_ENTRY
    setEntry(key, { ...prev, generating: false })
    return
  }
  pollCounts.set(key, nextCount)
  const timer = setTimeout(() => {
    retryTimers.delete(key)
    void loadMeta(id, lang, true)
  }, pollDelayMs(nextCount))
  retryTimers.set(key, timer)
}

async function loadMeta(id: number, lang: LyricTargetLang, force = false): Promise<void> {
  if (!Number.isFinite(id) || id <= 0 || !lang)
    return
  const key = cacheKey(id, lang)
  if (inFlight.has(key))
    return
  if (!force && cache.has(key)) {
    const existing = cache.get(key)
    if (!existing?.generating)
      return
  }

  inFlight.add(key)
  try {
    const res = await fetchSongTranslationMeta(id, lang)
    if (!res) {
      clearRetry(key)
      const prev = cache.get(key)
      setEntry(key, { data: prev?.data ?? null, generating: false })
      return
    }
    const generating = res.status === 'pending' || Boolean(res.stale)
    const prev = cache.get(key)
    setEntry(key, {
      data: res.status === 'ready' ? res : (prev?.data ?? null),
      generating,
    })
    if (generating)
      schedulePoll(id, lang)
    else
      clearRetry(key)
  }
  catch {
    clearRetry(key)
    const prev = cache.get(key)
    setEntry(key, { data: prev?.data ?? null, generating: false })
  }
  finally {
    inFlight.delete(key)
  }
}

export function requestSongMetaTranslation(id: number | null, lang: LyricTargetLang) {
  if (id == null || id <= 0 || !lang)
    return
  void loadMeta(id, lang, false)
}

/** 管理员手动重新生成指定语言下的歌名与歌手译名，返回 'started' 或 'unavailable' */
export async function refreshSongMetaTranslations(id: number, lang: LyricTargetLang): Promise<'started' | 'unavailable'> {
  if (!Number.isFinite(id) || id <= 0 || !lang)
    return 'unavailable'
  const key = cacheKey(id, lang)
  clearRetry(key)
  try {
    const res = await refreshSongTranslationMeta(id, lang)
    const generating = res.status === 'pending' || Boolean(res.stale)
    const prev = cache.get(key)
    setEntry(key, {
      data: res.status === 'ready' ? res : (prev?.data ?? null),
      generating,
    })
    if (generating)
      schedulePoll(id, lang)
    return 'started'
  }
  catch (error) {
    const status = isAxiosError(error) ? error.response?.status : undefined
    if (status === 404 || status === 400) {
      const prev = cache.get(key)
      setEntry(key, { data: prev?.data ?? null, generating: false })
      return 'unavailable'
    }
    throw error
  }
}

function getEntry(id: number | null, lang: LyricTargetLang): CacheEntry {
  if (id == null || id <= 0 || !lang)
    return EMPTY_ENTRY
  return cache.get(cacheKey(id, lang)) ?? EMPTY_ENTRY
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSongMetaTranslation(id: number | null, lang: LyricTargetLang): MusicSongTranslationMeta | null {
  return useSyncExternalStore(
    subscribe,
    () => getEntry(id, lang).data,
    () => null,
  )
}

/** 只读订阅当前界面语言下已缓存的歌曲标题与歌手译名，绝不主动发起请求 */
export function useCachedSongMetaTranslation(id: number | null): MusicSongTranslationMeta | null {
  const locale = useLocale()
  const lang = toLyricTargetLang(locale)
  return useSyncExternalStore(
    subscribe,
    () => getEntry(id, lang).data,
    () => null,
  )
}

export function useSongMetaTranslationGenerating(id: number | null, lang: LyricTargetLang): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getEntry(id, lang).generating,
    () => false,
  )
}
