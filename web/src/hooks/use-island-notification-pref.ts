'use client'

import { useSyncExternalStore } from 'react'

export const ISLAND_NOTIFICATION_STORAGE_KEY = 'neo-blog:island-notification-enabled'

const listeners = new Set<() => void>()
let storageListenerBound = false

function ensureStorageListener() {
  if (storageListenerBound || typeof window === 'undefined')
    return
  storageListenerBound = true
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === ISLAND_NOTIFICATION_STORAGE_KEY) {
      for (const listener of listeners)
        listener()
    }
  })
}

export function getIslandNotificationEnabled(): boolean {
  if (typeof window === 'undefined')
    return true
  try {
    return window.localStorage.getItem(ISLAND_NOTIFICATION_STORAGE_KEY) !== '0'
  }
  catch {
    return true
  }
}

export function setIslandNotificationEnabled(enabled: boolean) {
  if (typeof window === 'undefined')
    return
  try {
    window.localStorage.setItem(ISLAND_NOTIFICATION_STORAGE_KEY, enabled ? '1' : '0')
  }
  catch {
    // 隐私模式或存储受限时忽略写入失败
  }
  for (const listener of listeners)
    listener()
}

function subscribe(listener: () => void): () => void {
  ensureStorageListener()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 用户级「新通知顶栏灵动岛提醒」开关（持久化于单一 localStorage 键，跨标签页同步，默认开启） */
export function useIslandNotificationPref(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, getIslandNotificationEnabled, () => true)
  return [enabled, setIslandNotificationEnabled]
}
