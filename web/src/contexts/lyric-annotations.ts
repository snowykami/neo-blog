'use client'

import type { LyricAnnotations } from '@/lib/lyrics/emphasis'
import { useCallback, useSyncExternalStore } from 'react'
import { fetchLyricAnnotations, refreshLyricAnnotations } from '@/api/music'

/**
 * 歌词标注（见 spec 7.2b）：读者播放到某首歌时才请求（懒处理），后端还在生成时每隔 POLL_MS 再取一次，
 * 最多等待 MAX_POLLS 次；结果按歌曲 id 缓存在本页内。没有标注（未配置大模型、不在博客歌单内、生成失败）时为 null，
 * 本次访问内不再请求。后端返回旧结果（stale，过期或管理员刷新后正在重新生成）时先使用旧结果，继续轮询直到拿到新结果。
 * generating 表示后端正在生成（首次生成的 pending、重新生成的 stale、管理员刷新后），供 AI 标志呼吸闪烁
 */

// 每 2 秒取一次，最多等 3 分钟
const POLL_MS = 2000
const MAX_POLLS = 90

interface Entry {
  // undefined 为尚未取到（请求中或等待生成）
  value?: LyricAnnotations | null
  listeners: Set<() => void>
  started: boolean
  // 每次开始轮询加一，旧的轮询发现不是最新一轮时停止（管理员刷新会重新开始轮询）
  round: number
  generating: boolean
}

const entries = new Map<number, Entry>()

function getEntry(id: number): Entry {
  let entry = entries.get(id)
  if (!entry) {
    entry = { listeners: new Set(), started: false, round: 0, generating: false }
    entries.set(id, entry)
  }
  return entry
}

function settle(entry: Entry, value: LyricAnnotations | null, generating = false) {
  entry.value = value
  entry.generating = generating
  entry.listeners.forEach(listener => listener())
}

function setGenerating(entry: Entry, generating: boolean) {
  if (entry.generating === generating)
    return
  entry.generating = generating
  entry.listeners.forEach(listener => listener())
}

/** 开始获取一首歌的标注（已开始或已有结果时不重复请求） */
export function requestLyricAnnotations(id: number) {
  const entry = getEntry(id)
  if (entry.started)
    return
  entry.started = true
  const round = ++entry.round
  let polls = 0
  const load = () => {
    if (round !== entry.round)
      return
    fetchLyricAnnotations(id).then((result) => {
      if (round !== entry.round)
        return
      if (!result) {
        // 刷新期间失败时保留已有的旧结果
        settle(entry, entry.value ?? null)
        return
      }
      const generating = result.status === 'pending' || !!result.stale
      if (result.status === 'ready')
        settle(entry, { font: result.font, intro: result.intro, outro: result.outro, moments: result.moments, lines: result.lines }, generating)
      else
        setGenerating(entry, generating)
      if (!generating)
        return
      polls++
      if (polls < MAX_POLLS)
        setTimeout(load, POLL_MS)
      else
        settle(entry, entry.value ?? null)
    }, () => {
      if (round === entry.round)
        settle(entry, entry.value ?? null)
    })
  }
  load()
}

/** 管理员手动重新生成一首歌的标注：请求后台开始生成，再重新轮询；新结果生成前继续使用旧结果 */
export async function refreshAnnotations(id: number) {
  await refreshLyricAnnotations(id)
  const entry = getEntry(id)
  setGenerating(entry, true)
  entry.started = false
  requestLyricAnnotations(id)
}

/** 订阅一首歌已取到的标注；没有（或还没取到）时为 null */
export function useLyricAnnotations(id: number | null): LyricAnnotations | null {
  const valid = id != null && id > 0
  const subscribe = useCallback((listener: () => void) => {
    if (!valid)
      return () => {}
    const entry = getEntry(id)
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
    }
  }, [id, valid])
  return useSyncExternalStore(subscribe, () => (valid ? entries.get(id)?.value ?? null : null), () => null)
}

/** 一首歌的标注是否正在生成（首次生成或重新生成） */
export function useLyricAnnotationsGenerating(id: number | null): boolean {
  const valid = id != null && id > 0
  const subscribe = useCallback((listener: () => void) => {
    if (!valid)
      return () => {}
    const entry = getEntry(id)
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
    }
  }, [id, valid])
  return useSyncExternalStore(subscribe, () => (valid ? entries.get(id)?.generating ?? false : false), () => false)
}
