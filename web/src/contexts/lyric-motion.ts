'use client'

import type { LyricMotion, LyricSource } from '@/lib/lyrics/types'
import { useCallback, useSyncExternalStore } from 'react'
import { fetchLyricMotion, refreshLyricMotion } from '@/api/music'
import { onLyricAnnotationsReady, reloadAnnotations } from './lyric-annotations'

export interface SiteLyricMotion {
  motion: LyricMotion
  source?: LyricSource | ''
  ai: boolean
}

const POLL_MS = 2000
const MAX_POLLS = 45

function pollDelayMs(polls: number): number {
  return polls <= 1 ? 800 : polls === 2 ? 1200 : POLL_MS
}

interface MotionEntry {
  value?: SiteLyricMotion | null
  listeners: Set<() => void>
  started: boolean
  round: number
  generating: boolean
}

const entries = new Map<string, MotionEntry>()

function makeKey(id: number, source: LyricSource | null | undefined): string {
  return `${id}:${source && source !== 'none' ? source : ''}`
}

function getEntry(key: string): MotionEntry {
  let entry = entries.get(key)
  if (!entry) {
    entry = { listeners: new Set(), started: false, round: 0, generating: false }
    entries.set(key, entry)
  }
  return entry
}

function notify(entry: MotionEntry) {
  entry.listeners.forEach(listener => listener())
}

function settle(entry: MotionEntry, value: SiteLyricMotion | null, generating = false) {
  const unchanged = entry.generating === generating
    && entry.value?.motion === value?.motion
    && entry.value?.ai === value?.ai
    && entry.value?.source === value?.source
    && (entry.value === null) === (value === null)
  entry.value = value
  entry.generating = generating
  if (!unchanged)
    notify(entry)
}

export function requestLyricMotion(id: number, source?: LyricSource | null) {
  if (id <= 0)
    return
  const normSource = source && source !== 'none' ? source : undefined
  const key = makeKey(id, normSource)
  const entry = getEntry(key)
  if (entry.started)
    return
  entry.started = true
  const round = ++entry.round
  let polls = 0

  const load = (syncAnnotationsOnReady = false) => {
    if (round !== entry.round)
      return
    fetchLyricMotion(id, normSource).then((result) => {
      if (round !== entry.round)
        return
      if (!result) {
        settle(entry, entry.value ?? null, false)
        return
      }
      const generating = result.status === 'pending' || !!result.stale
      settle(
        entry,
        {
          motion: result.motion,
          source: result.source,
          ai: Boolean(result.ai),
        },
        generating,
      )
      if (!generating) {
        if (syncAnnotationsOnReady)
          reloadAnnotations(id)
        return
      }
      polls++
      if (polls < MAX_POLLS)
        setTimeout(load, pollDelayMs(polls), syncAnnotationsOnReady)
      else
        settle(entry, entry.value ?? null, false)
    }, () => {
      if (round === entry.round)
        settle(entry, entry.value ?? null, false)
    })
  }
  load(false)
}

export async function refreshMotion(id: number, source?: LyricSource | null): Promise<'started' | 'failed'> {
  if (id <= 0)
    return 'failed'
  const normSource = source && source !== 'none' ? source : undefined
  const key = makeKey(id, normSource)
  await refreshLyricMotion(id, normSource)
  const entry = getEntry(key)
  entry.generating = true
  entry.started = true
  const round = ++entry.round
  notify(entry)

  let polls = 0
  const poll = () => {
    if (round !== entry.round)
      return
    fetchLyricMotion(id, normSource).then((result) => {
      if (round !== entry.round)
        return
      if (!result) {
        settle(entry, entry.value ?? null, false)
        return
      }
      const generating = result.status === 'pending' || !!result.stale
      settle(
        entry,
        {
          motion: result.motion,
          source: result.source,
          ai: Boolean(result.ai),
        },
        generating,
      )
      if (!generating) {
        reloadAnnotations(id)
        return
      }
      polls++
      if (polls < MAX_POLLS)
        setTimeout(poll, pollDelayMs(polls))
      else
        settle(entry, entry.value ?? null, false)
    }, () => {
      if (round === entry.round)
        settle(entry, entry.value ?? null, false)
    })
  }
  setTimeout(poll, 700)
  return 'started'
}

export function reloadMotion(id: number) {
  const prefix = `${id}:`
  for (const [key, entry] of entries.entries()) {
    if (key.startsWith(prefix) && entry.started) {
      const rawSource = key.slice(prefix.length) as LyricSource | ''
      entry.started = false
      requestLyricMotion(id, rawSource || undefined)
    }
  }
}

onLyricAnnotationsReady(id => reloadMotion(id))

export function useLyricMotion(id: number | null, source?: LyricSource | null): SiteLyricMotion | null {
  const valid = id != null && id > 0 && source !== 'none'
  const key = valid ? makeKey(id, source) : ''
  const subscribe = useCallback((listener: () => void) => {
    if (!valid)
      return () => {}
    const entry = getEntry(key)
    entry.listeners.add(listener)
    return () => entry.listeners.delete(listener)
  }, [key, valid])
  return useSyncExternalStore(
    subscribe,
    () => (valid ? entries.get(key)?.value ?? null : null),
    () => null,
  )
}

export function useLyricMotionGenerating(id: number | null, source?: LyricSource | null): boolean {
  const valid = id != null && id > 0 && source !== 'none'
  const key = valid ? makeKey(id, source) : ''
  const subscribe = useCallback((listener: () => void) => {
    if (!valid)
      return () => {}
    const entry = getEntry(key)
    entry.listeners.add(listener)
    return () => entry.listeners.delete(listener)
  }, [key, valid])
  return useSyncExternalStore(
    subscribe,
    () => (valid ? entries.get(key)?.generating ?? false : false),
    () => false,
  )
}
