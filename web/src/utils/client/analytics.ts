import type { VisitTargetType } from '@/models/visit'
import { init, track } from '@plausible-analytics/tracker'
import { apiUrl } from '@/utils/common/api-url'
import { doNotTrack, getFingerprint } from './fingerprint'
import { collectVisitSignals } from './visit-signals'

/**
 * 访客统计：沿用 Plausible 官方 tracker 采集访问、阅读参与度（有效停留时长、滚动深度）、外链点击与文件下载，
 * 上报到本站兼容 Plausible 事件协议的接口（后端 controller.Visit.Event），不经过任何第三方服务
 */
let initialized = false
// 下一次 pageview 的来源页：站内跳转时 document.referrer 不会更新，由 VisitReporter 传入上一个页面
let nextReferrer: string | null = null

function ensureTracker() {
  if (initialized || typeof window === 'undefined')
    return
  initialized = true
  init({
    domain: window.location.hostname,
    endpoint: apiUrl('/api/v1/event'),
    autoCapturePageviews: false, // 由 VisitReporter 在路由变化后上报，附带文章ID与浏览器信号
    outboundLinks: true,
    fileDownloads: true,
    // 本地开发也上报；同时不跳过自动化浏览器，交给后端识别为“疑似自动化”
    captureOnLocalhost: true,
    logging: false,
    bindToWindow: false,
    transformRequest: (payload) => {
      // 开启请勿追踪时只上报访问本身（后端只做匿名计数），不上报停留时长、点击与性能数据
      if (payload.n !== 'pageview')
        return doNotTrack() ? null : payload
      if (nextReferrer !== null) {
        payload.r = nextReferrer
        nextReferrer = null
      }
      return payload
    },
  })
}

// 上报一次访问，后端会写入/刷新访客 Cookie
export async function trackPageview({ url, referrer, targetType, targetId }: {
  url: string
  referrer: string
  targetType?: VisitTargetType
  targetId?: number
}) {
  const fingerprint = await getFingerprint()
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
  ensureTracker()
  nextReferrer = referrer
  track('pageview', { url, props })
}

// 上报一项 Web Vitals 指标；不计入互动
export function trackWebVital({ name, value, rating }: { name: string, value: number, rating: string }) {
  ensureTracker()
  track('Web Vital', { props: { metric: name, value: Math.round(value * 1000) / 1000, rating }, interactive: false })
}
