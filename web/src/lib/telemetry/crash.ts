import type { Breadcrumb } from '@sentry/browser'
import { addEventProcessor, captureEvent, getIsolationScope } from '@sentry/browser'
import { collectTelemetryContexts } from './context'

/**
 * 页面进程崩溃检测：内存超限或浏览器引擎自身崩溃时，系统直接杀掉页面进程，脚本来不及上报（如 iOS Safari 显示「重复出现问题」）。
 * 页面活着时定期把心跳、地址、最近的面包屑与应用状态写进 sessionStorage（同一标签页内，进程崩溃后浏览器重新加载时仍在）；
 * 正常离开（pagehide）时清掉。下次打开时发现上一次没有正常离开，就补报一条：离开前在前台为崩溃，在后台为被系统回收（内存紧张时常见）
 *
 * sessionStorage 会被复制进从本页打开的新标签页 / 窗口（如编辑器打开预览、Safari 里在新标签页打开链接）、「复制标签页」：
 * 新页面读到的是仍然活着的原页面的心跳，不能当成崩溃。所以每个页面带一个随机 id，补报前先在 BroadcastChannel 里问一声，
 * 原页面还活着就会应答，不补报；真正崩溃的页面没法应答
 */

const KEY = 'nb_page_alive'
const BEAT_MS = 5000
const CRUMB_LIMIT = 20
const CHANNEL = 'nb_page_alive'
// 等原页面应答的时长：同一浏览器内的消息通常几毫秒就到，留足余量给刚启动、主线程繁忙的页面
const PING_TIMEOUT_MS = 1000

interface AliveState {
  /** 页面实例 id（旧版本记录的状态没有） */
  id?: string
  url: string
  startedAt: number
  beatAt: number
  hidden: boolean
  crumbs: Breadcrumb[]
  contexts: Record<string, Record<string, unknown>>
}

function read(): AliveState | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as AliveState : null
  }
  catch {
    return null
  }
}

let state: AliveState | null = null
// 页面正在离开：pagehide 之后浏览器还会触发 visibilitychange（hidden），这时不能再把状态写回去，否则每次正常跳转都会被当成崩溃
let leaving = false

function write() {
  if (!state || leaving)
    return
  state.url = location.href.replace(/[?#].*$/, '')
  state.beatAt = Date.now()
  state.hidden = document.visibilityState === 'hidden'
  // 面包屑记在隔离作用域里，取最近的几条（已按 client.ts 的 beforeBreadcrumb 去掉查询参数）
  const crumbs = (getIsolationScope().getScopeData().breadcrumbs ?? []).slice(-CRUMB_LIMIT)
  state.crumbs = crumbs.map(({ timestamp, category, message, level, data }) => ({ timestamp, category, message, level, data }))
  state.contexts = collectTelemetryContexts()
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state))
  }
  catch {}
}

/** 补报上一次没有正常离开的页面 */
function reportPrevious(previous: AliveState) {
  const discarded = previous.hidden
  captureEvent({
    message: discarded ? 'Page discarded in background' : 'Page crashed',
    level: discarded ? 'warning' : 'fatal',
    tags: { kind: discarded ? 'discarded' : 'crash' },
    request: { url: previous.url },
    breadcrumbs: previous.crumbs,
    contexts: {
      ...previous.contexts,
      crash: {
        url: previous.url,
        started_at: new Date(previous.startedAt).toISOString(),
        last_beat_at: new Date(previous.beatAt).toISOString(),
        uptime_s: Math.round((previous.beatAt - previous.startedAt) / 1000),
        hidden: previous.hidden,
      },
    },
  })
}

function randomId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 问一声 id 对应的页面是否还活着（在别的标签页里）；不支持 BroadcastChannel 时按已经不在处理 */
function isStillAlive(channel: BroadcastChannel | null, id: string | undefined): Promise<boolean> {
  if (!channel || !id)
    return Promise.resolve(false)
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'pong' && event.data.id === id)
        finish(true)
    }
    const timer = window.setTimeout(finish, PING_TIMEOUT_MS, false)
    function finish(alive: boolean) {
      window.clearTimeout(timer)
      channel!.removeEventListener('message', onMessage)
      resolve(alive)
    }
    channel.addEventListener('message', onMessage)
    channel.postMessage({ type: 'ping', id })
  })
}

export function startCrashDetector() {
  let previous: AliveState | null = null
  try {
    previous = read()
  }
  catch {}

  let channel: BroadcastChannel | null = null
  try {
    channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null
  }
  catch {}
  const id = randomId()
  state = { id, url: '', startedAt: Date.now(), beatAt: 0, hidden: false, crumbs: [], contexts: {} }
  // 别的页面来问「你还活着吗」：问的是本页且没有正在离开时应答
  channel?.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === 'ping' && event.data.id === id && !leaving)
      channel?.postMessage({ type: 'pong', id })
  })
  if (previous) {
    const last = previous
    void isStillAlive(channel, last.id).then((alive) => {
      if (!alive)
        reportPrevious(last)
    })
  }

  write()
  const timer = window.setInterval(write, BEAT_MS)
  document.addEventListener('visibilitychange', write)
  // 正常离开（关闭、刷新、跳到其他站点）：清掉；进入往返缓存后又回来时重新开始
  window.addEventListener('pagehide', () => {
    leaving = true
    try {
      sessionStorage.removeItem(KEY)
    }
    catch {}
  })
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      leaving = false
      write()
    }
  })
  // 上报错误时同时刷新一次（崩溃常紧跟在错误之后）
  addEventProcessor((event) => {
    write()
    return event
  })
  return () => window.clearInterval(timer)
}
