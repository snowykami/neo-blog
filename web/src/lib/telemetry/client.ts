import type { Breadcrumb, ErrorEvent } from '@sentry/browser'
import * as Sentry from '@sentry/browser'
import { CHUNK_LOAD_MESSAGE_RE } from '@/utils/client/chunk-error'
import { doNotTrack } from '@/utils/client/fingerprint'
import { collectVisitSignals } from '@/utils/client/visit-signals'
import { collectTelemetryContexts } from './context'
import { startCrashDetector } from './crash'

/**
 * 浏览器端的错误报告：用开源的 Sentry SDK 采集未捕获的异常、未处理的 Promise、错误边界捕获的错误与面包屑（路由跳转、点击、请求、控制台警告），
 * 经 tunnel 发到本站（Next 服务端还原源码位置后转给后端，见 app/api/v1/telemetry/envelope），不连接 Sentry 的服务。
 * 页面进程被系统杀掉时脚本来不及上报，由 crash.ts 在下次打开时补报。
 * 开启请勿追踪时只报错误本身、页面地址与浏览器版本：不附设备信号（后端也不关联访客与用户）
 */

const TUNNEL = '/api/v1/telemetry/envelope'
// SDK 需要一个 DSN 才会启用；事件全部经 tunnel 发到本站，这个地址不会被访问
const DSN = 'https://telemetry@neo-blog.invalid/1'
// 同一页面最多上报的事件数（出错循环时不刷屏；后端另按 IP 限频、按问题限量保存）
const MAX_EVENTS_PER_PAGE = 20
const MAX_BREADCRUMBS = 50
// 构建版本（CI 传入 commit）与环境，构建时内联；版本用于在控制台区分问题出现在哪次部署
// eslint-disable-next-line node/prefer-global/process
const RELEASE = process.env.NEXT_PUBLIC_APP_VERSION?.trim() || undefined
// eslint-disable-next-line node/prefer-global/process
const ENVIRONMENT = process.env.NODE_ENV

// 没有排查价值的噪音：浏览器扩展、跨域脚本、网络中断、新版本部署后的旧代码块加载失败（由错误边界刷新页面恢复）
const IGNORE_ERRORS: (string | RegExp)[] = [
  /ResizeObserver loop/,
  /^Script error\.?$/,
  /^(?:TypeError: )?(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/,
  /AbortError|The operation was aborted|signal is aborted/i,
  /ChunkLoadError/,
  CHUNK_LOAD_MESSAGE_RE,
  /Non-Error promise rejection captured/,
]
const DENY_URLS = [/^(?:chrome|moz|safari(?:-web)?)-extension:/i, /^chrome:\/\//i, /extensions\//i]
// 错误报告与访客统计自己的请求不记面包屑
const QUIET_REQUESTS = /\/api\/v1\/(?:telemetry\/envelope|event)(?:\?|$)/

let sentEvents = 0
let started = false

/** 去掉地址中的查询参数与片段（可能带着令牌等信息） */
function stripQuery(url: unknown) {
  return typeof url === 'string' ? url.replace(/[?#].*$/, '') : url
}

function beforeBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === 'console' && !(crumb.level === 'warning' || crumb.level === 'error'))
    return null
  const data = crumb.data
  if (data) {
    if ((crumb.category === 'fetch' || crumb.category === 'xhr') && QUIET_REQUESTS.test(String(data.url ?? '')))
      return null
    for (const key of ['url', 'from', 'to'])
      data[key] = stripQuery(data[key])
  }
  return crumb
}

function beforeSend(event: ErrorEvent): ErrorEvent | null {
  if (++sentEvents > MAX_EVENTS_PER_PAGE)
    return null
  if (event.request?.url)
    event.request.url = stripQuery(event.request.url) as string
  // 用户与访客由后端按登录态与访客 Cookie 关联（开启请勿追踪时不关联），这里不带
  delete event.user
  const contexts = { ...event.contexts, ...collectTelemetryContexts() }
  contexts.page = {
    visibility: document.visibilityState,
    online: navigator.onLine,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  }
  if (!doNotTrack()) {
    const nav = navigator as Navigator & { deviceMemory?: number, connection?: { effectiveType?: string, saveData?: boolean } }
    contexts.signals = {
      ...collectVisitSignals(),
      memory: nav.deviceMemory,
      cores: nav.hardwareConcurrency,
      connection: nav.connection?.effectiveType,
      save_data: nav.connection?.saveData,
    }
  }
  event.contexts = contexts
  return event
}

/** 初始化错误报告（由 loader.ts 在浏览器空闲时或需要上报时调用一次） */
export function startTelemetry() {
  if (started || typeof window === 'undefined')
    return
  started = true
  Sentry.init({
    dsn: DSN,
    tunnel: TUNNEL,
    release: RELEASE,
    environment: ENVIRONMENT,
    sendClientReports: false,
    maxBreadcrumbs: MAX_BREADCRUMBS,
    // 不收集用户信息、Cookie、请求与响应的内容和查询参数；请求头只留 UA（后端据此解析浏览器与系统）
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
    },
    ignoreErrors: IGNORE_ERRORS,
    denyUrls: DENY_URLS,
    // 只启用需要的集成：不做会话统计、性能追踪与录屏
    defaultIntegrations: false,
    integrations: [
      Sentry.eventFiltersIntegration(),
      Sentry.browserApiErrorsIntegration(),
      Sentry.breadcrumbsIntegration({ dom: true, fetch: true, xhr: true, history: true, sentry: false }),
      Sentry.consoleIntegration(),
      Sentry.globalHandlersIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.httpContextIntegration(),
    ],
    beforeBreadcrumb,
    beforeSend,
  })
  startCrashDetector()
}

/** 错误边界捕获的错误（错误页）：返回事件 ID，显示在错误详情里，读者反馈时据此查找 */
export function captureBoundaryError(error: Error & { digest?: string }) {
  return Sentry.withScope((scope) => {
    if (error.digest)
      scope.setTag('digest', error.digest)
    return Sentry.captureException(error, { mechanism: { type: 'react.error_boundary', handled: false } })
  })
}

/** SDK 加载前记下的未捕获异常（见 loader.ts）：按全局未捕获异常补报 */
export function captureEarlyError(error: unknown) {
  Sentry.captureException(error, { mechanism: { type: 'onerror', handled: false } })
}

/** 路由跳转记为面包屑（instrumentation-client.ts 的 onRouterTransitionStart，经 loader.ts） */
export function recordNavigation(url: string, navigationType: string) {
  Sentry.addBreadcrumb({ category: 'navigation', data: { to: stripQuery(url), type: navigationType } })
}
