'use client'

import type { SiteLyricPronunciations } from '@/lib/lyrics/lyric-pronunciation'
import type { LyricSource } from '@/lib/lyrics/types'
import { isAxiosError } from 'axios'
import { useSyncExternalStore } from 'react'
import { fetchLyricPronunciations, refreshLyricPronunciations } from '@/api/music'

const POLL_MS = 2000
const MAX_POLLS = 90

function pollDelayMs(polls: number): number {
  return polls <= 1 ? 800 : polls === 2 ? 1200 : POLL_MS
}

interface CacheEntry {
  data: SiteLyricPronunciations | null
  generating: boolean
}

const EMPTY_ENTRY: CacheEntry = { data: null, generating: false }
const cache = new Map<string, CacheEntry>()
const inFlight = new Set<string>()
const pollCounts = new Map<string, number>()
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()

function cacheKey(id: number, source: string): string {
  return `${id}:${source}`
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

function shouldUsePronunciationPayload(res: SiteLyricPronunciations, prev?: CacheEntry): boolean {
  if (res.status === 'ready')
    return true
  const nextCount = res.lines?.length ?? 0
  if (nextCount === 0)
    return false
  const prevCount = prev?.data?.lines.length ?? 0
  return prevCount === 0 || nextCount > prevCount
}

function schedulePoll(id: number, source: string) {
  const key = cacheKey(id, source)
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
    void loadPronunciations(id, source, true)
  }, pollDelayMs(nextCount))
  retryTimers.set(key, timer)
}

async function loadPronunciations(id: number, source: string, force = false): Promise<void> {
  if (!Number.isFinite(id) || id <= 0 || !source || source === 'none')
    return
  const key = cacheKey(id, source)
  if (inFlight.has(key))
    return
  if (!force && cache.has(key)) {
    const existing = cache.get(key)
    if (!existing?.generating)
      return
  }

  inFlight.add(key)
  try {
    const res = await fetchLyricPronunciations(id, source as LyricSource)
    if (!res) {
      clearRetry(key)
      const prev = cache.get(key)
      setEntry(key, { data: prev?.data ?? null, generating: false })
      return
    }
    const generating = res.status === 'pending' || Boolean(res.stale)
    const prev = cache.get(key)
    setEntry(key, {
      data: shouldUsePronunciationPayload(res, prev) ? res : (prev?.data ?? null),
      generating,
    })
    if (generating)
      schedulePoll(id, source)
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

export function requestLyricPronunciations(id: number | null, source: string | null | undefined) {
  if (id == null || id <= 0 || !source || source === 'none')
    return
  void loadPronunciations(id, source, false)
}

/** 管理员手动重新生成指定词源的 AI 标准读音，返回 'started' 或 'unavailable' */
export async function refreshPronunciations(id: number, source: string): Promise<'started' | 'unavailable'> {
  if (!Number.isFinite(id) || id <= 0 || !source || source === 'none')
    return 'unavailable'
  const key = cacheKey(id, source)
  clearRetry(key)
  try {
    const res = await refreshLyricPronunciations(id, source as LyricSource)
    const generating = res.status === 'pending' || Boolean(res.stale)
    const prev = cache.get(key)
    setEntry(key, {
      data: shouldUsePronunciationPayload(res, prev) ? res : (prev?.data ?? null),
      generating,
    })
    if (generating)
      schedulePoll(id, source)
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

function getEntry(id: number | null, source: string | null | undefined): CacheEntry {
  if (id == null || id <= 0 || !source || source === 'none')
    return EMPTY_ENTRY
  return cache.get(cacheKey(id, source)) ?? EMPTY_ENTRY
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLyricPronunciations(
  id: number | null,
  source: string | null | undefined,
): SiteLyricPronunciations | null {
  return useSyncExternalStore(
    subscribe,
    () => getEntry(id, source).data,
    () => null,
  )
}

export function useLyricPronunciationsGenerating(
  id: number | null,
  source: string | null | undefined,
): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getEntry(id, source).generating,
    () => false,
  )
}
