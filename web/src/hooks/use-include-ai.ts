'use client'

import { useCallback, useSyncExternalStore } from 'react'

/** 统一保存是否包含站内 AI 用户的本地存储键，默认开启（true） */
export const INCLUDE_AI_STORAGE_KEY = 'include-ai'

const listeners = new Set<() => void>()
let cachedValue: boolean | null = null

function parseStored(raw: string | null): boolean {
  return raw !== 'false'
}

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined')
    return true
  if (cachedValue !== null)
    return cachedValue
  try {
    cachedValue = parseStored(localStorage.getItem(INCLUDE_AI_STORAGE_KEY))
  }
  catch {
    cachedValue = true
  }
  return cachedValue
}

function setIncludeAIValue(next: boolean) {
  if (cachedValue === next)
    return
  cachedValue = next
  try {
    localStorage.setItem(INCLUDE_AI_STORAGE_KEY, String(next))
  }
  catch {
    // 隐私模式或存储受限时保留内存状态，当前会话内依然同步生效
  }
  emitChange()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === INCLUDE_AI_STORAGE_KEY) {
      try {
        cachedValue = parseStored(localStorage.getItem(INCLUDE_AI_STORAGE_KEY))
      }
      catch {
        cachedValue = true
      }
      listener()
    }
  }
  if (typeof window !== 'undefined')
    window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined')
      window.removeEventListener('storage', onStorage)
  }
}

/** 单测重置内存缓存用 */
export function resetIncludeAICache() {
  cachedValue = null
}

/**
 * 读写统一的「包含 AI 用户」偏好（共用单一 localStorage 键 `include-ai`），
 * 在访客记录、访客统计等涉及页面及多标签页之间实时同步
 */
export function useIncludeAI(): [boolean, (next: boolean) => void] {
  const includeAi = useSyncExternalStore(subscribe, getSnapshot, () => true)
  const setIncludeAi = useCallback((next: boolean) => {
    setIncludeAIValue(next)
  }, [])
  return [includeAi, setIncludeAi]
}
