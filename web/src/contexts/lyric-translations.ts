'use client'

import type {
  MusicLyricTranslationLangStatus,
  MusicLyricTranslationLanguages,
  MusicLyricTranslationLine,
  MusicLyricTranslations,
} from '@/api/music'
import type { LyricSource } from '@/lib/lyrics/types'
import { isAxiosError } from 'axios'
import { useEffect, useSyncExternalStore } from 'react'
import {
  fetchLyricTranslationLanguages,
  fetchLyricTranslations,
  refreshLyricTranslations,
  streamLyricTranslations,
} from '@/api/music'

export interface SiteLyricTranslations {
  source?: LyricSource | ''
  targetLang?: string
  native?: boolean
  sameLanguage?: boolean
  lines: MusicLyricTranslationLine[]
}

const FAILURE_RETRY_MS = 30_000
const UNMOUNT_ABORT_DELAY_MS = 1500

interface CacheEntry {
  data: SiteLyricTranslations | null
  generating: boolean
}

const EMPTY_ENTRY: CacheEntry = { data: null, generating: false }
const cache = new Map<string, CacheEntry>()
const inFlightRequests = new Set<string>()
const inFlightStreams = new Map<string, AbortController>()
const failedAt = new Map<string, number>()
const activeRefs = new Map<string, number>()
const abortTimers = new Map<string, ReturnType<typeof setTimeout>>()
const languagesCache = new Map<string, MusicLyricTranslationLanguages | null>()
const inFlightLangRequests = new Set<string>()
const langFailedAt = new Map<string, number>()
const listeners = new Set<() => void>()

function cacheKey(id: number, source: string, lang: string): string {
  return `${id}:${source}:${lang}`
}

function validKey(id: number | null, source: string | null | undefined, lang: string): string | null {
  if (id == null || !Number.isFinite(id) || id <= 0 || !source || source === 'none' || !lang)
    return null
  return cacheKey(id, source, lang)
}

function validSourceKey(id: number | null, source: string | null | undefined): string | null {
  if (id == null || !Number.isFinite(id) || id <= 0 || !source || source === 'none')
    return null
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

function setLanguagesEntry(key: string, next: MusicLyricTranslationLanguages | null) {
  const prev = languagesCache.get(key)
  if (prev === next)
    return
  languagesCache.set(key, next)
  emit()
}

function updateLanguageStatusEntry(
  id: number,
  source: string,
  lang: string,
  patch: Partial<MusicLyricTranslationLangStatus>,
) {
  const key = validSourceKey(id, source)
  if (!key)
    return
  const current = languagesCache.get(key)
  if (!current)
    return
  const idx = current.languages.findIndex(item => item.lang === lang)
  if (idx < 0)
    return
  const prevItem = current.languages[idx]
  const nextItem: MusicLyricTranslationLangStatus = { ...prevItem, ...patch }
  if (
    prevItem.hasAi === nextItem.hasAi
    && prevItem.hasNative === nextItem.hasNative
    && prevItem.generating === nextItem.generating
    && prevItem.sameLanguage === nextItem.sameLanguage
  ) {
    return
  }
  const nextLanguages = [...current.languages]
  nextLanguages[idx] = nextItem
  setLanguagesEntry(key, { ...current, languages: nextLanguages })
}

function toSiteTranslations(res: MusicLyricTranslations, fallbackSource?: string, fallbackLang?: string): SiteLyricTranslations {
  return {
    source: res.source || (fallbackSource as LyricSource | undefined),
    targetLang: res.targetLang || fallbackLang,
    native: res.native,
    sameLanguage: res.sameLanguage,
    lines: Array.isArray(res.lines) ? res.lines : [],
  }
}

function lineIdentity(line: MusicLyricTranslationLine): string {
  return `${Boolean(line.bg)}:${line.occurrence}:${line.text}`
}

function upsertTranslationLine(list: MusicLyricTranslationLine[], item: MusicLyricTranslationLine): MusicLyricTranslationLine[] {
  const id = lineIdentity(item)
  const idx = list.findIndex(existing => lineIdentity(existing) === id)
  if (idx >= 0) {
    const next = [...list]
    next[idx] = item
    return next
  }
  return [...list, item]
}

function mergeStaleLines(base: MusicLyricTranslationLine[], streamed: MusicLyricTranslationLine[]): MusicLyricTranslationLine[] {
  if (base.length === 0)
    return streamed
  let merged = [...base]
  for (const item of streamed)
    merged = upsertTranslationLine(merged, item)
  return merged
}

async function openTranslationStream(
  id: number,
  source: string,
  lang: string,
  initial: MusicLyricTranslations,
): Promise<void> {
  const key = cacheKey(id, source, lang)
  if (inFlightStreams.has(key))
    return

  const controller = new AbortController()
  inFlightStreams.set(key, controller)

  const staleBase = initial.status === 'ready' && initial.lines?.length ? initial.lines : []
  let streamedLines: MusicLyricTranslationLine[] = initial.status === 'pending' && initial.lines?.length
    ? [...initial.lines]
    : []
  const resolvedSource: LyricSource | '' = initial.source || (source as LyricSource)
  const resolvedLang = initial.targetLang || lang
  let gotError = false
  let doneReceived = false

  const emitProgress = () => {
    const lines = staleBase.length > 0 ? mergeStaleLines(staleBase, streamedLines) : [...streamedLines]
    if (lines.length === 0 && !cache.get(key)?.data)
      return
    setEntry(key, {
      data: {
        source: resolvedSource,
        targetLang: resolvedLang,
        lines,
      },
      generating: true,
    })
  }

  try {
    const completed = await streamLyricTranslations(id, source, lang, {
      signal: controller.signal,
      onEvent: (event) => {
        switch (event.event) {
          case 'replay':
            streamedLines = [...event.lines]
            emitProgress()
            break
          case 'line':
            streamedLines = upsertTranslationLine(streamedLines, event.line)
            emitProgress()
            break
          case 'done': {
            doneReceived = true
            failedAt.delete(key)
            const doneSource = event.meta.source || resolvedSource
            const doneLang = event.meta.targetLang || resolvedLang
            const hasAiResult = !event.meta.native && !event.meta.sameLanguage && streamedLines.length > 0
            setEntry(key, {
              data: {
                source: doneSource,
                targetLang: doneLang,
                native: event.meta.native,
                sameLanguage: event.meta.sameLanguage,
                lines: streamedLines.length > 0 ? [...streamedLines] : (event.meta.sameLanguage || event.meta.native ? [] : staleBase),
              },
              generating: false,
            })
            updateLanguageStatusEntry(id, doneSource, doneLang, {
              generating: false,
              ...(hasAiResult ? { hasAi: true } : {}),
            })
            if (hasAiResult && doneSource)
              void loadTranslationLanguages(id, doneSource, true)
            break
          }
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
      updateLanguageStatusEntry(id, resolvedSource || source, resolvedLang, { generating: false })
    }
  }
  finally {
    if (inFlightStreams.get(key) === controller)
      inFlightStreams.delete(key)
  }
}

async function loadTranslations(id: number, source: string, lang: string, force = false): Promise<void> {
  const key = validKey(id, source, lang)
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
    const res = await fetchLyricTranslations(id, source, lang)
    if (!res) {
      setEntry(key, EMPTY_ENTRY)
      return
    }
    const needsStream = res.status === 'pending' || Boolean(res.stale)
    const prev = cache.get(key)
    const acceptPartial = res.status === 'pending' && Boolean(res.lines?.length) && !prev?.data?.lines.length
    const hasUsableData = res.status === 'ready' || acceptPartial
    const finalSource = res.source || source
    const finalLang = res.targetLang || lang
    setEntry(key, {
      data: hasUsableData ? toSiteTranslations(res, source, lang) : (prev?.data ?? null),
      generating: needsStream,
    })
    if (needsStream) {
      updateLanguageStatusEntry(id, finalSource, finalLang, { generating: true })
      void openTranslationStream(id, source, lang, res)
    }
    else {
      failedAt.delete(key)
      if (res.status === 'ready' && !res.native && !res.sameLanguage && Boolean(res.lines?.length))
        updateLanguageStatusEntry(id, finalSource, finalLang, { generating: false, hasAi: true })
    }
  }
  catch {
    failedAt.set(key, Date.now())
    const prev = cache.get(key)
    setEntry(key, { data: prev?.data ?? null, generating: false })
    updateLanguageStatusEntry(id, source, lang, { generating: false })
  }
  finally {
    inFlightRequests.delete(key)
  }
}

async function loadTranslationLanguages(id: number, source: string, force = false): Promise<void> {
  if (typeof fetchLyricTranslationLanguages !== 'function')
    return
  const key = validSourceKey(id, source)
  if (!key || inFlightLangRequests.has(key))
    return
  if (!force) {
    const failed = langFailedAt.get(key)
    if (failed != null && Date.now() - failed < FAILURE_RETRY_MS)
      return
    const existing = languagesCache.get(key)
    if (existing && existing.status === 'ready')
      return
  }

  inFlightLangRequests.add(key)
  try {
    const res = await fetchLyricTranslationLanguages(id, source)
    langFailedAt.delete(key)
    setLanguagesEntry(key, res)
  }
  catch {
    langFailedAt.set(key, Date.now())
  }
  finally {
    inFlightLangRequests.delete(key)
  }
}

export function requestLyricTranslationLanguages(
  id: number | null,
  source: string | null | undefined,
  force = false,
) {
  if (!validSourceKey(id, source))
    return
  void loadTranslationLanguages(id!, source!, force)
}

export function requestLyricTranslations(id: number | null, source: string | null | undefined, lang: string) {
  if (!validKey(id, source, lang))
    return
  void loadTranslations(id!, source!, lang, false)
}

// 管理员手动重新生成指定词源与目标语言的 AI 歌词翻译，返回 'started' 或 'unavailable'
export async function refreshTranslations(id: number, source: string, lang: string): Promise<'started' | 'unavailable'> {
  const key = validKey(id, source, lang)
  if (!key)
    return 'unavailable'
  failedAt.delete(key)
  inFlightStreams.get(key)?.abort()
  inFlightStreams.delete(key)
  updateLanguageStatusEntry(id, source, lang, { generating: true })
  try {
    const res = await refreshLyricTranslations(id, source, lang)
    const needsStream = res.status === 'pending' || Boolean(res.stale)
    const prev = cache.get(key)
    const acceptPartial = res.status === 'pending' && Boolean(res.lines?.length) && !prev?.data?.lines.length
    const hasUsableData = res.status === 'ready' || acceptPartial
    const finalSource = res.source || source
    const finalLang = res.targetLang || lang
    setEntry(key, {
      data: hasUsableData ? toSiteTranslations(res, source, lang) : (prev?.data ?? null),
      generating: needsStream,
    })
    if (needsStream) {
      updateLanguageStatusEntry(id, finalSource, finalLang, { generating: true })
      void openTranslationStream(id, source, lang, res)
    }
    else {
      const hasAiResult = res.status === 'ready' && !res.native && !res.sameLanguage && Boolean(res.lines?.length)
      updateLanguageStatusEntry(id, finalSource, finalLang, {
        generating: false,
        ...(hasAiResult ? { hasAi: true } : {}),
      })
      if (hasAiResult && finalSource)
        void loadTranslationLanguages(id, finalSource, true)
    }
    return 'started'
  }
  catch (error) {
    updateLanguageStatusEntry(id, source, lang, { generating: false })
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
  const key = validKey(id, source, lang)
  if (!key)
    return EMPTY_ENTRY
  return cache.get(key) ?? EMPTY_ENTRY
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function useRetainTranslationStream(id: number | null, source: string | null | undefined, lang: string) {
  const key = validKey(id, source, lang)
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

export function useLyricTranslations(
  id: number | null,
  source: string | null | undefined,
  lang: string,
): SiteLyricTranslations | null {
  useRetainTranslationStream(id, source, lang)
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

export function useLyricTranslationLanguages(
  id: number | null,
  source: string | null | undefined,
): MusicLyricTranslationLanguages | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      const key = validSourceKey(id, source)
      return key ? (languagesCache.get(key) ?? null) : null
    },
    () => null,
  )
}

/** 测试辅助：重置模块内缓存与进行中流 */
export function resetLyricTranslationsStoreForTest() {
  for (const timer of abortTimers.values())
    clearTimeout(timer)
  abortTimers.clear()
  for (const controller of inFlightStreams.values())
    controller.abort()
  inFlightStreams.clear()
  inFlightRequests.clear()
  inFlightLangRequests.clear()
  failedAt.clear()
  langFailedAt.clear()
  activeRefs.clear()
  cache.clear()
  languagesCache.clear()
}
