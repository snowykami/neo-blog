'use client'

import type { SiteLyricPronunciationLine, SiteLyricPronunciations } from '@/lib/lyrics/lyric-pronunciation'
import type { LyricSource } from '@/lib/lyrics/types'
import { isAxiosError } from 'axios'
import { useEffect, useSyncExternalStore } from 'react'
import {
  fetchLyricPronunciations,
  refreshLyricPronunciations,
  streamLyricPronunciations,
} from '@/api/music'

const FAILURE_RETRY_MS = 30_000
const UNMOUNT_ABORT_DELAY_MS = 1500

interface CacheEntry {
  data: SiteLyricPronunciations | null
  generating: boolean
}

const EMPTY_ENTRY: CacheEntry = { data: null, generating: false }
const cache = new Map<string, CacheEntry>()
const inFlightRequests = new Set<string>()
const inFlightStreams = new Map<string, AbortController>()
const failedAt = new Map<string, number>()
const activeRefs = new Map<string, number>()
const abortTimers = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()

function cacheKey(id: number, source: string): string {
  return `${id}:${source}`
}

function validKey(id: number | null, source: string | null | undefined): string | null {
  if (id == null || !Number.isFinite(id) || id <= 0 || !source || source === 'none')
    return null
  return cacheKey(id, source)
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

function shouldUsePronunciationPayload(res: SiteLyricPronunciations, prev?: CacheEntry): boolean {
  if (res.status === 'ready')
    return true
  const nextCount = res.lines?.length ?? 0
  if (nextCount === 0)
    return false
  const prevCount = prev?.data?.lines.length ?? 0
  return prevCount === 0 || nextCount > prevCount
}

function lineIdentity(line: SiteLyricPronunciationLine): string {
  return `${Boolean(line.bg)}:${line.occurrence}:${line.text}`
}

function upsertPronunciationLine(list: SiteLyricPronunciationLine[], item: SiteLyricPronunciationLine): SiteLyricPronunciationLine[] {
  const id = lineIdentity(item)
  const idx = list.findIndex(existing => lineIdentity(existing) === id)
  if (idx >= 0) {
    const next = [...list]
    next[idx] = item
    return next
  }
  return [...list, item]
}

function mergeStaleLines(base: SiteLyricPronunciationLine[], streamed: SiteLyricPronunciationLine[]): SiteLyricPronunciationLine[] {
  if (base.length === 0)
    return streamed
  let merged = [...base]
  for (const item of streamed)
    merged = upsertPronunciationLine(merged, item)
  return merged
}

async function openPronunciationStream(
  id: number,
  source: string,
  initial: SiteLyricPronunciations,
): Promise<void> {
  const key = cacheKey(id, source)
  if (inFlightStreams.has(key))
    return

  const controller = new AbortController()
  inFlightStreams.set(key, controller)

  const staleBase = initial.status === 'ready' && initial.lines?.length ? initial.lines : []
  let streamedLines: SiteLyricPronunciationLine[] = initial.status === 'pending' && initial.lines?.length
    ? [...initial.lines]
    : []
  const resolvedSource = initial.source || source
  const resolvedLang = initial.lang
  let gotError = false
  let doneReceived = false

  const emitProgress = () => {
    const lines = staleBase.length > 0 ? mergeStaleLines(staleBase, streamedLines) : [...streamedLines]
    if (lines.length === 0 && !cache.get(key)?.data)
      return
    setEntry(key, {
      data: {
        status: 'pending',
        source: resolvedSource,
        lang: resolvedLang,
        lines,
      },
      generating: true,
    })
  }

  try {
    const completed = await streamLyricPronunciations(id, source as LyricSource, {
      signal: controller.signal,
      onEvent: (event) => {
        switch (event.event) {
          case 'replay':
            streamedLines = [...event.lines]
            emitProgress()
            break
          case 'line':
            streamedLines = upsertPronunciationLine(streamedLines, event.line)
            emitProgress()
            break
          case 'done':
            doneReceived = true
            failedAt.delete(key)
            setEntry(key, {
              data: {
                status: 'ready',
                source: event.meta.source || resolvedSource,
                lang: event.meta.lang || resolvedLang,
                completeUpstream: event.meta.completeUpstream,
                lines: streamedLines.length > 0 ? [...streamedLines] : (event.meta.completeUpstream ? [] : staleBase),
              },
              generating: false,
            })
            break
          case 'error':
            gotError = true
            break
        }
      },
    })

    if (controller.signal.aborted)
      return
    if (!completed || !doneReceived || gotError) {
      failedAt.set(key, Date.now())
      const prev = cache.get(key)
      setEntry(key, { data: prev?.data ?? null, generating: false })
    }
  }
  finally {
    if (inFlightStreams.get(key) === controller)
      inFlightStreams.delete(key)
  }
}

async function loadPronunciations(id: number, source: string, force = false): Promise<void> {
  const key = validKey(id, source)
  if (!key)
    return
  if (inFlightRequests.has(key) || inFlightStreams.has(key))
    return
  if (!force) {
    const failed = failedAt.get(key)
    if (failed != null && Date.now() - failed < FAILURE_RETRY_MS)
      return
    const existing = cache.get(key)
    if (existing && !existing.generating)
      return
  }

  inFlightRequests.add(key)
  try {
    const res = await fetchLyricPronunciations(id, source as LyricSource)
    if (!res) {
      const prev = cache.get(key)
      setEntry(key, { data: prev?.data ?? null, generating: false })
      return
    }
    const needsStream = res.status === 'pending' || Boolean(res.stale)
    const prev = cache.get(key)
    setEntry(key, {
      data: shouldUsePronunciationPayload(res, prev)
        ? { ...res, source: res.source || source }
        : (prev?.data ?? null),
      generating: needsStream,
    })
    if (needsStream)
      void openPronunciationStream(id, source, res)
    else
      failedAt.delete(key)
  }
  catch {
    failedAt.set(key, Date.now())
    const prev = cache.get(key)
    setEntry(key, { data: prev?.data ?? null, generating: false })
  }
  finally {
    inFlightRequests.delete(key)
  }
}

export function requestLyricPronunciations(id: number | null, source: string | null | undefined) {
  if (!validKey(id, source))
    return
  void loadPronunciations(id!, source!, false)
}

/** 管理员手动重新生成指定词源的 AI 标准读音，返回 'started' 或 'unavailable' */
export async function refreshPronunciations(id: number, source: string): Promise<'started' | 'unavailable'> {
  const key = validKey(id, source)
  if (!key)
    return 'unavailable'
  failedAt.delete(key)
  inFlightStreams.get(key)?.abort()
  inFlightStreams.delete(key)
  try {
    const res = await refreshLyricPronunciations(id, source as LyricSource)
    const needsStream = res.status === 'pending' || Boolean(res.stale)
    const prev = cache.get(key)
    setEntry(key, {
      data: shouldUsePronunciationPayload(res, prev)
        ? { ...res, source: res.source || source }
        : (prev?.data ?? null),
      generating: needsStream,
    })
    if (needsStream)
      void openPronunciationStream(id, source, res)
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
  const key = validKey(id, source)
  if (!key)
    return EMPTY_ENTRY
  return cache.get(key) ?? EMPTY_ENTRY
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function useRetainPronunciationStream(id: number | null, source: string | null | undefined) {
  const key = validKey(id, source)
  useEffect(() => {
    if (!key)
      return
    const pendingTimer = abortTimers.get(key)
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      abortTimers.delete(key)
    }
    activeRefs.set(key, (activeRefs.get(key) ?? 0) + 1)
    return () => {
      const next = (activeRefs.get(key) ?? 1) - 1
      if (next > 0) {
        activeRefs.set(key, next)
        return
      }
      activeRefs.delete(key)
      const timer = setTimeout(() => {
        abortTimers.delete(key)
        if ((activeRefs.get(key) ?? 0) === 0) {
          inFlightStreams.get(key)?.abort()
          inFlightStreams.delete(key)
        }
      }, UNMOUNT_ABORT_DELAY_MS)
      abortTimers.set(key, timer)
    }
  }, [key])
}

export function useLyricPronunciations(
  id: number | null,
  source: string | null | undefined,
): SiteLyricPronunciations | null {
  useRetainPronunciationStream(id, source)
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

/** 测试辅助：重置模块内缓存与进行中流 */
export function resetLyricPronunciationsStoreForTest() {
  for (const timer of abortTimers.values())
    clearTimeout(timer)
  abortTimers.clear()
  for (const controller of inFlightStreams.values())
    controller.abort()
  inFlightStreams.clear()
  inFlightRequests.clear()
  failedAt.clear()
  activeRefs.clear()
  cache.clear()
}
