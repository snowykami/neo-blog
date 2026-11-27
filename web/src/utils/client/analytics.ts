import type { VisitTargetType } from '@/models/visit'
import { doNotTrack, getFingerprint } from './fingerprint'
import { collectVisitSignals } from './visit-signals'

/**
 * 访客统计与事件埋点客户端：
 * - 保持与后端 Plausible 事件协议（POST /api/v1/event）完全兼容，不引入重型第三方 SDK
 * - pageview 在切页后立即串行发送，确保后端尽早种下/刷新 nb_vid 访客 Cookie
 * - engagement、Web Vital、外链点击、文件下载统一进入内存缓冲队列（EventBatcher）：
 *   队列内自动合并同页面 engagement，按条数阈值、定时空闲回调（requestIdleCallback）或离页 sendBeacon 批量提交
 * - 遇到 HTTP 429 时解析 Retry-After 进入退避熔断窗口，静默暂停非关键事件并清空积压队列
 */

export const EVENT_ENDPOINT = '/api/v1/event'
export const DEFAULT_BATCH_SIZE_THRESHOLD = 10
export const DEFAULT_FLUSH_INTERVAL_MS = 5000
export const DEFAULT_IDLE_TIMEOUT_MS = 2000
export const MAX_BATCH_ITEMS = 50
export const MIN_ENGAGEMENT_MS = 3000
export const MAX_WEB_VITAL_VALUE = 600_000
export const DEFAULT_BACKOFF_MS = 120_000
const MIN_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 15 * 60_000
export const MAX_EVENT_URL_LENGTH = 1024

const VALID_WEB_VITAL_METRICS = new Set(['LCP', 'INP', 'CLS', 'FCP', 'TTFB'])
const VALID_WEB_VITAL_RATINGS = new Set(['good', 'needs-improvement', 'poor'])

const DOWNLOAD_EXTENSIONS = new Set([
  'pdf',
  'xls',
  'xlsx',
  'doc',
  'docx',
  'txt',
  'rtf',
  'csv',
  'exe',
  'key',
  'pps',
  'ppt',
  'pptx',
  '7z',
  'pkg',
  'rar',
  'gz',
  'zip',
  'avi',
  'mov',
  'mp4',
  'mpeg',
  'wmv',
  'midi',
  'mp3',
  'wav',
  'wma',
  'dmg',
  'iso',
  'apk',
  'deb',
  'rpm',
])

export type AnalyticsEventName
  = | 'pageview'
    | 'engagement'
    | 'Outbound Link: Click'
    | 'File Download'
    | 'Web Vital'

export interface PlausibleEventPayload {
  n: AnalyticsEventName
  u: string
  d: string
  r?: string
  p?: Record<string, string | number | boolean>
  sd?: number
  e?: number
}

export type FlushTrigger = 'threshold' | 'timer' | 'beacon' | 'manual'

export interface EventBatcherOptions {
  endpoint?: string
  batchSizeThreshold?: number
  flushIntervalMs?: number
  idleTimeoutMs?: number
  defaultBackoffMs?: number
  beforeNetworkFlush?: () => Promise<void> | void
}

export function truncateEventUrl(raw: string, maxLength = MAX_EVENT_URL_LENGTH): string {
  const trimmed = raw.trim()
  if (trimmed.length <= maxLength)
    return trimmed

  let end = maxLength
  // 避免在 UTF-16 高低代理对中间截断产生孤立代理项
  const code = trimmed.charCodeAt(end - 1)
  if (code >= 0xD800 && code <= 0xDBFF)
    end -= 1

  let sliced = trimmed.slice(0, end).replace(/%[0-9a-f]?$/i, '')
  // 若尾部落在多字节百分号编码序列（如中文 %E4%B8%AD）中间，逐个回退残缺字节直至可合法解码
  const trailingEncoded = sliced.match(/(?:%[0-9a-f]{2})+$/i)
  if (trailingEncoded) {
    let seq = trailingEncoded[0]
    const prefix = sliced.slice(0, sliced.length - seq.length)
    for (let i = 0; i < 4 && seq.length > 0; i++) {
      try {
        decodeURIComponent(seq)
        break
      }
      catch {
        seq = seq.slice(0, -3)
      }
    }
    sliced = prefix + seq
  }
  return sliced
}

function cleanCurrentLocationUrl(): string {
  if (typeof window === 'undefined')
    return ''
  return `${window.location.origin}${window.location.pathname}${window.location.search}`
}

export function parseRetryAfterMs(retryAfter: string | null | undefined, fallbackMs = DEFAULT_BACKOFF_MS, now = Date.now()): number {
  if (!retryAfter)
    return fallbackMs
  const trimmed = retryAfter.trim()
  if (!trimmed)
    return fallbackMs
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds)) {
    if (seconds <= 0)
      return MIN_BACKOFF_MS
    return Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, Math.round(seconds * 1000)))
  }
  const targetMs = Date.parse(trimmed)
  if (!Number.isNaN(targetMs)) {
    const delta = targetMs - now
    if (delta <= 0)
      return MIN_BACKOFF_MS
    return Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, delta))
  }
  return fallbackMs
}

export class EventBatcher {
  private queue: PlausibleEventPayload[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private idleHandle: number | null = null
  private backoffUntil = 0
  private generation = 0
  private readonly endpoint: string
  private readonly batchSizeThreshold: number
  private readonly flushIntervalMs: number
  private readonly idleTimeoutMs: number
  private readonly defaultBackoffMs: number
  private readonly beforeNetworkFlush?: () => Promise<void> | void

  constructor(options: EventBatcherOptions = {}) {
    this.endpoint = options.endpoint ?? EVENT_ENDPOINT
    this.batchSizeThreshold = options.batchSizeThreshold ?? DEFAULT_BATCH_SIZE_THRESHOLD
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.defaultBackoffMs = options.defaultBackoffMs ?? DEFAULT_BACKOFF_MS
    this.beforeNetworkFlush = options.beforeNetworkFlush
  }

  getQueueSnapshot(): ReadonlyArray<PlausibleEventPayload> {
    return this.queue
  }

  isRateLimited(now = Date.now()): boolean {
    return now < this.backoffUntil
  }

  getBackoffUntil(): number {
    return this.backoffUntil
  }

  activateBackoff(retryAfterHeader?: string | null, now = Date.now()) {
    const waitMs = parseRetryAfterMs(retryAfterHeader, this.defaultBackoffMs, now)
    this.backoffUntil = Math.max(this.backoffUntil, now + waitMs)
    this.clearSchedule()
    this.queue.length = 0
  }

  enqueue(event: PlausibleEventPayload) {
    if (typeof window === 'undefined' || doNotTrack() || this.isRateLimited())
      return

    // 同一页面、同一待发批次内的多次 engagement 合并为单条：累加停留时长、滚动深度取最大
    if (event.n === 'engagement') {
      const existing = this.queue.find(item => item.n === 'engagement' && item.u === event.u)
      if (existing) {
        existing.e = (existing.e ?? 0) + (event.e ?? 0)
        existing.sd = Math.max(existing.sd ?? 0, event.sd ?? 0)
        return
      }
    }

    if (this.queue.length >= MAX_BATCH_ITEMS)
      this.queue.shift()
    this.queue.push(event)

    if (this.queue.length >= this.batchSizeThreshold) {
      this.clearSchedule()
      void this.flush('threshold')
      return
    }

    this.scheduleFlush()
  }

  async flush(trigger: FlushTrigger = 'manual'): Promise<void> {
    this.clearSchedule()
    if (this.queue.length === 0)
      return
    if (this.isRateLimited()) {
      this.queue.length = 0
      return
    }

    const flushGeneration = this.generation

    // 非离页场景等待在途 pageview 先返回，确保首访 nb_vid Cookie 与访问记录已落库
    if (trigger !== 'beacon' && this.beforeNetworkFlush) {
      await this.beforeNetworkFlush()
      if (this.generation !== flushGeneration || this.queue.length === 0)
        return
      if (this.isRateLimited()) {
        this.queue.length = 0
        return
      }
    }

    const batch = this.queue.splice(0, MAX_BATCH_ITEMS)
    if (this.queue.length > 0 && trigger !== 'beacon')
      this.scheduleFlush()

    const body = JSON.stringify({ events: batch })

    if (trigger === 'beacon' && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        if (navigator.sendBeacon(this.endpoint, body))
          return
      }
      catch {
        // sendBeacon 失败时回退到 keepalive fetch
      }
    }

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
        keepalive: trigger === 'beacon',
      })
      if (this.generation === flushGeneration && res.status === 429)
        this.activateBackoff(res.headers?.get?.('Retry-After'))
    }
    catch {
      // 网络波动或离线时静默丢弃，不阻塞页面主流程
    }
  }

  reset() {
    this.generation += 1
    this.clearSchedule()
    this.queue.length = 0
    this.backoffUntil = 0
  }

  private scheduleFlush() {
    if (this.flushTimer !== null || this.idleHandle !== null)
      return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        this.idleHandle = window.requestIdleCallback(() => {
          this.idleHandle = null
          void this.flush('timer')
        }, { timeout: this.idleTimeoutMs })
      }
      else {
        void this.flush('timer')
      }
    }, this.flushIntervalMs)
  }

  private clearSchedule() {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.idleHandle !== null) {
      if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function')
        window.cancelIdleCallback(this.idleHandle)
      this.idleHandle = null
    }
  }
}

let inFlightPageview: Promise<void> | null = null
let analyticsGeneration = 0

const batcher = new EventBatcher({
  beforeNetworkFlush: async () => {
    if (inFlightPageview)
      await inFlightPageview
  },
})

let cleanupListeners: (() => void) | null = null
let currentPageUrl = ''
let engagedAccumulatedMs = 0
let activeSinceMs: number | null = null
let isWindowBlurred = false
let maxScrollDepth = 0
let lastReportedScrollDepth = 0
let scrollRafId: number | null = null

function isPageActivelyEngaged(): boolean {
  return typeof document !== 'undefined' && document.visibilityState !== 'hidden' && !isWindowBlurred
}

function computeScrollDepth(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined')
    return 0
  const docEl = document.documentElement
  const docHeight = Math.max(
    docEl?.scrollHeight ?? 0,
    docEl?.offsetHeight ?? 0,
    document.body?.scrollHeight ?? 0,
  )
  const winHeight = window.innerHeight || docEl?.clientHeight || 0
  if (docHeight <= 0)
    return 0
  if (docHeight <= winHeight)
    return 100
  return Math.min(100, Math.max(0, Math.round(((window.scrollY + winHeight) / docHeight) * 100)))
}

function pauseActiveEngagement(now = Date.now()) {
  if (activeSinceMs !== null) {
    engagedAccumulatedMs += Math.max(0, now - activeSinceMs)
    activeSinceMs = null
  }
}

function resumeActiveEngagement(now = Date.now()) {
  if (!currentPageUrl || !isPageActivelyEngaged())
    return
  if (activeSinceMs === null)
    activeSinceMs = now
}

function snapshotEngagementToQueue(now = Date.now()) {
  if (activeSinceMs !== null) {
    engagedAccumulatedMs += Math.max(0, now - activeSinceMs)
    activeSinceMs = isPageActivelyEngaged() ? now : null
  }
  if (!currentPageUrl || typeof window === 'undefined' || doNotTrack() || batcher.isRateLimited(now)) {
    engagedAccumulatedMs = 0
    lastReportedScrollDepth = maxScrollDepth
    return
  }
  if (engagedAccumulatedMs >= MIN_ENGAGEMENT_MS || maxScrollDepth > lastReportedScrollDepth) {
    const engagedMs = engagedAccumulatedMs
    const scrollDepth = maxScrollDepth
    engagedAccumulatedMs = 0
    lastReportedScrollDepth = maxScrollDepth
    batcher.enqueue({
      n: 'engagement',
      u: currentPageUrl,
      d: window.location.hostname,
      e: engagedMs,
      sd: scrollDepth,
    })
  }
}

function extractFileExtension(pathname: string): string {
  const lastSegment = pathname.split('/').pop() ?? ''
  const dotIndex = lastSegment.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1)
    return ''
  return lastSegment.slice(dotIndex + 1).toLowerCase()
}

function handleDocumentClick(event: MouseEvent) {
  if (!currentPageUrl || typeof window === 'undefined' || doNotTrack() || batcher.isRateLimited())
    return
  if (event.type === 'click' && event.button !== 0)
    return
  if (event.type === 'auxclick' && event.button !== 1)
    return
  const target = event.target
  if (!(target instanceof Element))
    return
  const anchor = target.closest('a[href]')
  const rawHref = anchor?.getAttribute('href')?.trim()
  if (!rawHref)
    return

  let parsed: URL
  try {
    parsed = new URL(rawHref, window.location.href)
  }
  catch {
    return
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    return

  if (parsed.host && parsed.host !== window.location.host) {
    trackOutboundLink(parsed.href, currentPageUrl)
    return
  }
  const ext = extractFileExtension(parsed.pathname)
  if (ext && DOWNLOAD_EXTENSIONS.has(ext))
    trackFileDownload(`${parsed.origin}${parsed.pathname}`, currentPageUrl)
}

function ensureListeners() {
  if (cleanupListeners || typeof window === 'undefined' || typeof document === 'undefined')
    return

  const onScroll = () => {
    if (!currentPageUrl || maxScrollDepth >= 100 || scrollRafId !== null || doNotTrack() || batcher.isRateLimited())
      return
    scrollRafId = window.requestAnimationFrame(() => {
      scrollRafId = null
      if (!currentPageUrl)
        return
      const depth = computeScrollDepth()
      if (depth > maxScrollDepth)
        maxScrollDepth = depth
    })
  }

  const onBlur = () => {
    isWindowBlurred = true
    pauseActiveEngagement()
  }

  const onFocus = () => {
    isWindowBlurred = false
    resumeActiveEngagement()
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      pauseActiveEngagement()
      snapshotEngagementToQueue()
      void batcher.flush('beacon')
    }
    else {
      resumeActiveEngagement()
    }
  }

  const onPageHide = () => {
    pauseActiveEngagement()
    snapshotEngagementToQueue()
    void batcher.flush('beacon')
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibilityChange)
  document.addEventListener('click', handleDocumentClick, { capture: true, passive: true })
  document.addEventListener('auxclick', handleDocumentClick, { capture: true, passive: true })

  cleanupListeners = () => {
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    document.removeEventListener('click', handleDocumentClick, { capture: true })
    document.removeEventListener('auxclick', handleDocumentClick, { capture: true })
    if (scrollRafId !== null) {
      window.cancelAnimationFrame(scrollRafId)
      scrollRafId = null
    }
  }
}

// 离开公开访问页面（如进入 /console、/auth 或 /random 中转页）时结算上一页停留并停止采集
export function leavePageview() {
  if (!currentPageUrl)
    return
  pauseActiveEngagement()
  snapshotEngagementToQueue()
  currentPageUrl = ''
  engagedAccumulatedMs = 0
  activeSinceMs = null
  maxScrollDepth = 0
  lastReportedScrollDepth = 0
}

// 上报一次访问，后端会写入/刷新访客 Cookie（nb_vid）；并发切页时按队列串行发送避免首访产生双访客记录
export function trackPageview({ url, referrer, targetType, targetId }: {
  url: string
  referrer: string
  targetType?: VisitTargetType
  targetId?: number
}): Promise<void> {
  if (typeof window === 'undefined')
    return Promise.resolve()

  ensureListeners()

  const normalizedUrl = truncateEventUrl(url)
  if (!normalizedUrl)
    return Promise.resolve()

  if (currentPageUrl && currentPageUrl !== normalizedUrl)
    snapshotEngagementToQueue()

  currentPageUrl = normalizedUrl
  engagedAccumulatedMs = 0
  activeSinceMs = isPageActivelyEngaged() ? Date.now() : null
  maxScrollDepth = computeScrollDepth()
  lastReportedScrollDepth = maxScrollDepth

  const callGeneration = analyticsGeneration
  const previousSend = inFlightPageview ?? Promise.resolve()
  const task = previousSend.then(async () => {
    if (analyticsGeneration !== callGeneration)
      return
    const fingerprint = await getFingerprint()
    if (analyticsGeneration !== callGeneration)
      return
    const signals = collectVisitSignals()
    const props: Record<string, string | number | boolean> = {}
    if (targetType)
      props.target_type = targetType
    if (targetId)
      props.target_id = targetId
    if (fingerprint)
      props.fingerprint = fingerprint
    if (signals) {
      Object.assign(props, {
        time_zone: signals.timeZone,
        utc_offset: signals.utcOffset,
        languages: signals.languages.join(','),
        screen: signals.screen,
        dpr: signals.dpr,
        touch_points: signals.touchPoints,
        pointer: signals.pointer,
        color_scheme: signals.colorScheme,
        webdriver: signals.webdriver,
      })
    }

    const payload: PlausibleEventPayload = {
      n: 'pageview',
      u: normalizedUrl,
      d: window.location.hostname,
    }
    if (referrer) {
      const normalizedRef = truncateEventUrl(referrer)
      if (normalizedRef)
        payload.r = normalizedRef
    }
    if (Object.keys(props).length > 0)
      payload.p = props

    try {
      const res = await fetch(EVENT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload),
        keepalive: true,
      })
      if (analyticsGeneration === callGeneration && res.status === 429)
        batcher.activateBackoff(res.headers?.get?.('Retry-After'))
    }
    catch {
      // 上报失败不影响浏览
    }
  })

  const settled = task.finally(() => {
    if (inFlightPageview === settled)
      inFlightPageview = null
  })
  inFlightPageview = settled
  return settled
}

// 入队一项 Web Vitals 指标；越界或非有限值（如后台长挂起标签页唤醒 > 600s）直接忽略，避免污染整批上报
export function trackWebVital({ name, value, rating, url }: {
  name: string
  value: number
  rating: string
  url?: string
}) {
  if (typeof window === 'undefined')
    return
  if (!VALID_WEB_VITAL_METRICS.has(name) || !VALID_WEB_VITAL_RATINGS.has(rating))
    return
  if (!Number.isFinite(value) || value < 0 || value > MAX_WEB_VITAL_VALUE)
    return
  const resolvedUrl = truncateEventUrl(url || currentPageUrl || cleanCurrentLocationUrl())
  if (!resolvedUrl)
    return
  ensureListeners()
  batcher.enqueue({
    n: 'Web Vital',
    u: resolvedUrl,
    d: window.location.hostname,
    p: {
      metric: name,
      value: Math.round(value * 1000) / 1000,
      rating,
    },
  })
}

// 入队一次页面阅读参与度片段；同一待发批次内按页面自动累加合并
export function trackEngagement({ engagedMs, scrollDepth, url }: {
  engagedMs: number
  scrollDepth: number
  url?: string
}) {
  if (typeof window === 'undefined' || !Number.isFinite(engagedMs) || !Number.isFinite(scrollDepth))
    return
  const resolvedUrl = truncateEventUrl(url || currentPageUrl || cleanCurrentLocationUrl())
  if (!resolvedUrl)
    return
  ensureListeners()
  batcher.enqueue({
    n: 'engagement',
    u: resolvedUrl,
    d: window.location.hostname,
    e: Math.max(0, Math.round(engagedMs)),
    sd: Math.min(100, Math.max(0, Math.round(scrollDepth))),
  })
}

// 入队一次外链点击事件
export function trackOutboundLink(targetUrl: string, pageUrl?: string) {
  if (typeof window === 'undefined' || !/^https?:\/\//i.test(targetUrl.trim()))
    return
  const resolvedUrl = truncateEventUrl(pageUrl || currentPageUrl || cleanCurrentLocationUrl())
  if (!resolvedUrl)
    return
  ensureListeners()
  batcher.enqueue({
    n: 'Outbound Link: Click',
    u: resolvedUrl,
    d: window.location.hostname,
    p: { url: truncateEventUrl(targetUrl) },
  })
}

// 入队一次文件下载事件
export function trackFileDownload(fileUrl: string, pageUrl?: string) {
  if (typeof window === 'undefined' || !/^https?:\/\//i.test(fileUrl.trim()))
    return
  const resolvedUrl = truncateEventUrl(pageUrl || currentPageUrl || cleanCurrentLocationUrl())
  if (!resolvedUrl)
    return
  ensureListeners()
  batcher.enqueue({
    n: 'File Download',
    u: resolvedUrl,
    d: window.location.hostname,
    p: { url: truncateEventUrl(fileUrl) },
  })
}

export function flushAnalyticsEvents(trigger: FlushTrigger = 'manual'): Promise<void> {
  return batcher.flush(trigger)
}

export function isAnalyticsRateLimited(): boolean {
  return batcher.isRateLimited()
}

export function teardownAnalytics() {
  analyticsGeneration += 1
  cleanupListeners?.()
  cleanupListeners = null
  batcher.reset()
  inFlightPageview = null
  currentPageUrl = ''
  engagedAccumulatedMs = 0
  activeSinceMs = null
  isWindowBlurred = false
  maxScrollDepth = 0
  lastReportedScrollDepth = 0
}
