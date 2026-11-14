'use client'

import type { MusicLyricTranslationLine, MusicLyricTranslations } from '@/api/music'
import type { LyricSource } from '@/lib/lyrics/types'
import { isAxiosError } from 'axios'
import { useSyncExternalStore } from 'react'
import {
  fetchLyricTranslations,

  refreshLyricTranslations,
} from '@/api/music'

export interface SiteLyricTranslations {
  source?: LyricSource | ''
  targetLang?: string
  native?: boolean
  sameLanguage?: boolean
  lines: MusicLyricTranslationLine[]
}

const POLL_MS = 2000
const MAX_POLLS = 90

function pollDelayMs(polls: number): number {
  return polls <= 1 ? 800 : polls === 2 ? 1200 : POLL_MS
}

interface CacheEntry {
  data: SiteLyricTranslations | null
  generating: boolean
}

const EMPTY_ENTRY: CacheEntry = { data: null, generating: false }
const cache = new Map<string, CacheEntry>()
const inFlight = new Set<string>()
const pollCounts = new Map<string, number>()
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()

function cacheKey(id: number, source: string, lang: string): string {
  return `${id}:${source}:${lang}`
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

function toSiteTranslations(res: MusicLyricTranslations): SiteLyricTranslations {
  return {
    source: res.source,
    targetLang: res.targetLang,
    native: res.native,
    sameLanguage: res.sameLanguage,
    lines: Array.isArray(res.lines) ? res.lines : [],
  }
}

function schedulePoll(id: number, source: string, lang: string) {
  const key = cacheKey(id, source, lang)
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
    void loadTranslations(id, source, lang, true)
  }, pollDelayMs(nextCount))
  retryTimers.set(key, timer)
}

async function loadTranslations(id: number, source: string, lang: string, force = false): Promise<void> {
  if (!Number.isFinite(id) || id <= 0 || !source || source === 'none' || !lang)
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
    const res = await fetchLyricTranslations(id, source, lang)
    if (!res) {
      clearRetry(key)
      setEntry(key, EMPTY_ENTRY)
      return
    }
    const generating = res.status === 'pending' || Boolean(res.stale)
    const prev = cache.get(key)
    const acceptPartial = res.status === 'pending' && Boolean(res.lines?.length) && !prev?.data?.lines.length
    const hasUsableData = res.status === 'ready' || acceptPartial
    setEntry(key, {
      data: hasUsableData ? toSiteTranslations(res) : (prev?.data ?? null),
      generating,
    })
    if (generating) {
      schedulePoll(id, source, lang)
    }
    else {
      clearRetry(key)
    }
  }
  catch (error) {
    clearRetry(key)
    const status = isAxiosError(error) ? error.response?.status : undefined
    const prev = cache.get(key)
    if (status === 404 || status === 400 || status === 403 || status === 429 || status === 503) {
      setEntry(key, { data: prev?.data ?? null, generating: false })
      return
    }
    // 网络抖动等临时失败保留已有缓存但停止转圈，避免无限轮询
    setEntry(key, { data: prev?.data ?? null, generating: false })
  }
  finally {
    inFlight.delete(key)
  }
}

export function requestLyricTranslations(id: number | null, source: string | null | undefined, lang: string) {
  if (id == null || id <= 0 || !source || source === 'none' || !lang)
    return
  void loadTranslations(id, source, lang, false)
}

// 管理员手动重新生成指定词源与目标语言的 AI 歌词翻译，返回 'started' 或 'unavailable'
export async function refreshTranslations(id: number, source: string, lang: string): Promise<'started' | 'unavailable'> {
  if (!Number.isFinite(id) || id <= 0 || !source || source === 'none' || !lang)
    return 'unavailable'
  const key = cacheKey(id, source, lang)
  clearRetry(key)
  try {
    const res = await refreshLyricTranslations(id, source, lang)
    const generating = res.status === 'pending' || Boolean(res.stale)
    const prev = cache.get(key)
    const acceptPartial = res.status === 'pending' && Boolean(res.lines?.length) && !prev?.data?.lines.length
    const hasUsableData = res.status === 'ready' || acceptPartial
    setEntry(key, {
      data: hasUsableData ? toSiteTranslations(res) : (prev?.data ?? null),
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
      setEntry(key, { data: prev?.data ?? null, generating: false })
      return 'unavailable'
    }
    throw error
  }
}

function getEntry(id: number | null, source: string | null | undefined, lang: string): CacheEntry {
  if (id == null || id <= 0 || !source || source === 'none' || !lang)
    return EMPTY_ENTRY
  return cache.get(cacheKey(id, source, lang)) ?? EMPTY_ENTRY
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLyricTranslations(
  id: number | null,
  source: string | null | undefined,
  lang: string,
): SiteLyricTranslations | null {
  return useSyncExternalStore(
    subscribe,
    () => getEntry(id, source, lang).data,
    () => null,
  )
}

export function useLyricTranslationsGenerating(
  id: number | null,
  source: string | null | undefined,
  lang: string,
): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getEntry(id, source, lang).generating,
    () => false,
  )
}
