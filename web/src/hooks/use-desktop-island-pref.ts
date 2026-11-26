'use client'

import { useSyncExternalStore } from 'react'

export const DESKTOP_ISLAND_STORAGE_KEY = 'neo-blog:desktop-island-prefs'
export const DEFAULT_DESKTOP_ISLAND_PORT = 29170

export type DesktopIslandFormMode = 'auto' | 'notch' | 'capsule'
export type DesktopIslandConnectionStatus = 'disabled' | 'standby' | 'connecting' | 'connected' | 'disconnected'

export interface DesktopIslandPreferences {
  /** 是否启用本地桌面灵动岛联动（默认开启，仅在本页首次开始播放音乐后后台异步连接 127.0.0.1，绝不阻塞播放与首屏） */
  enabled: boolean
  /** 本地 WebSocket 监听端口（127.0.0.1:<port>） */
  port: number
  /** 顶部外观形态：无刘海悬浮胶囊（默认） / 自动检测物理刘海 / 强制刘海融合 */
  formMode: DesktopIslandFormMode
  /** 连接上桌面灵动岛后自动收起网页顶栏音乐胶囊，避免双岛同框 */
  hideWebIslandWhenConnected: boolean
  /** 连接上桌面灵动岛后同时隐藏网页右下角悬浮球 */
  hideFloatingBallWhenConnected: boolean
  /** 允许点按胶囊展开迷你播放器面板（对齐博客 settings.expand） */
  expandable: boolean
  /** 切歌前奏短暂显示歌名提示（对齐博客 settings.musicPeek） */
  showTrackPeek: boolean
  /** 暂停后保留胶囊显示当前句歌词与播放键（对齐博客 settings.musicPaused） */
  keepWhenPaused: boolean
  /** 右侧跟随节拍律动条（对齐博客 settings.musicBeat） */
  beatBars: boolean
  /** 副歌段描边与外发光（对齐博客 settings.musicChorus） */
  chorusGlow: boolean
  /** XDR 显示器原生 HDR/EDR 高光 */
  hdr: boolean
}

export const DEFAULT_DESKTOP_ISLAND_PREFS: DesktopIslandPreferences = {
  enabled: true,
  port: DEFAULT_DESKTOP_ISLAND_PORT,
  formMode: 'capsule',
  hideWebIslandWhenConnected: true,
  hideFloatingBallWhenConnected: false,
  expandable: true,
  showTrackPeek: true,
  keepWhenPaused: true,
  beatBars: true,
  chorusGlow: true,
  hdr: true,
}

function normalizePort(raw: unknown): number {
  const num = Number(raw)
  if (Number.isInteger(num) && num >= 1024 && num <= 65535)
    return num
  return DEFAULT_DESKTOP_ISLAND_PORT
}

function normalizeFormMode(raw: unknown): DesktopIslandFormMode {
  if (raw === 'notch' || raw === 'capsule' || raw === 'auto')
    return raw
  return 'capsule'
}

function parsePreferences(raw: string | null): DesktopIslandPreferences {
  if (!raw)
    return DEFAULT_DESKTOP_ISLAND_PREFS
  try {
    const parsed = JSON.parse(raw) as Partial<DesktopIslandPreferences>
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      port: normalizePort(parsed.port),
      formMode: normalizeFormMode(parsed.formMode),
      hideWebIslandWhenConnected: parsed.hideWebIslandWhenConnected !== false,
      hideFloatingBallWhenConnected: Boolean(parsed.hideFloatingBallWhenConnected),
      expandable: parsed.expandable !== false,
      showTrackPeek: parsed.showTrackPeek !== false,
      keepWhenPaused: parsed.keepWhenPaused !== false,
      beatBars: parsed.beatBars !== false,
      chorusGlow: parsed.chorusGlow !== false,
      hdr: parsed.hdr !== false,
    }
  }
  catch {
    return DEFAULT_DESKTOP_ISLAND_PREFS
  }
}

let cachedRaw: string | null | undefined
let cachedPrefs: DesktopIslandPreferences = DEFAULT_DESKTOP_ISLAND_PREFS
const prefListeners = new Set<() => void>()
let storageListenerBound = false

function ensureStorageListener() {
  if (storageListenerBound || typeof window === 'undefined')
    return
  storageListenerBound = true
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === DESKTOP_ISLAND_STORAGE_KEY) {
      cachedRaw = undefined
      for (const listener of prefListeners)
        listener()
    }
  })
}

export function getDesktopIslandPrefs(): DesktopIslandPreferences {
  if (typeof window === 'undefined')
    return DEFAULT_DESKTOP_ISLAND_PREFS
  try {
    const raw = window.localStorage.getItem(DESKTOP_ISLAND_STORAGE_KEY)
    if (raw !== cachedRaw) {
      cachedRaw = raw
      cachedPrefs = parsePreferences(raw)
    }
    return cachedPrefs
  }
  catch {
    return DEFAULT_DESKTOP_ISLAND_PREFS
  }
}

// MARK: - 本地连接运行态（供设置页状态徽标与网页内避让逻辑订阅）

interface RuntimeSnapshot {
  status: DesktopIslandConnectionStatus
  reconnectEpoch: number
}

let runtime: RuntimeSnapshot = {
  status: 'standby',
  reconnectEpoch: 0,
}
const runtimeListeners = new Set<() => void>()

export function setDesktopIslandRuntimeStatus(status: DesktopIslandConnectionStatus) {
  if (runtime.status === status)
    return
  runtime = { ...runtime, status }
  for (const listener of runtimeListeners)
    listener()
}

export function updateDesktopIslandPrefs(patch: Partial<DesktopIslandPreferences>) {
  if (typeof window === 'undefined')
    return
  const next: DesktopIslandPreferences = {
    ...getDesktopIslandPrefs(),
    ...patch,
  }
  next.port = normalizePort(next.port)
  next.formMode = normalizeFormMode(next.formMode)
  const serialized = JSON.stringify(next)
  cachedRaw = serialized
  cachedPrefs = next
  try {
    window.localStorage.setItem(DESKTOP_ISLAND_STORAGE_KEY, serialized)
  }
  catch {
    // 隐私模式或存储受限时保留内存态生效
  }
  if (!next.enabled)
    setDesktopIslandRuntimeStatus('disabled')
  else if (runtime.status === 'disabled')
    setDesktopIslandRuntimeStatus('standby')
  for (const listener of prefListeners)
    listener()
}

function subscribePrefs(listener: () => void): () => void {
  ensureStorageListener()
  prefListeners.add(listener)
  return () => {
    prefListeners.delete(listener)
  }
}

export function useDesktopIslandPrefs(): DesktopIslandPreferences {
  return useSyncExternalStore(subscribePrefs, getDesktopIslandPrefs, () => DEFAULT_DESKTOP_ISLAND_PREFS)
}

export function requestDesktopIslandReconnect() {
  runtime = { ...runtime, reconnectEpoch: runtime.reconnectEpoch + 1 }
  for (const listener of runtimeListeners)
    listener()
}

function subscribeRuntime(listener: () => void): () => void {
  runtimeListeners.add(listener)
  return () => {
    runtimeListeners.delete(listener)
  }
}

const SERVER_RUNTIME_SNAPSHOT: RuntimeSnapshot = {
  status: 'standby',
  reconnectEpoch: 0,
}

export function useDesktopIslandRuntime(): RuntimeSnapshot {
  return useSyncExternalStore(subscribeRuntime, () => runtime, () => SERVER_RUNTIME_SNAPSHOT)
}
