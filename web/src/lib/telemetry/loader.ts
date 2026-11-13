/**
 * 错误报告的按需加载（Sentry SDK 约 90 KB，不放进首屏）：页面脚本执行前只装两个轻量的全局监听，记下这期间的未捕获异常与路由跳转；
 * 浏览器空闲时（或错误边界需要上报时）再加载 client.ts、初始化 SDK，并补报记下的异常与面包屑。
 * 在 SDK 启动之前就因页面进程被杀掉而丢失的崩溃，仍由 crash.ts 在下次打开时补报（它的标记在 SDK 启动时写入，与之前一致）
 */

type TelemetryClient = typeof import('./client')

// 加载前最多记下的异常与跳转数（出错循环时不无限增长）
const MAX_EARLY_ERRORS = 20
const MAX_EARLY_NAVIGATIONS = 20
// 空闲回调的最长等待：页面一直很忙时也在这之后启动
const IDLE_TIMEOUT_MS = 4000

const earlyErrors: unknown[] = []
const earlyNavigations: [url: string, navigationType: string][] = []
let loading: Promise<TelemetryClient> | null = null
let client: TelemetryClient | null = null

function onError(event: ErrorEvent) {
  if (earlyErrors.length < MAX_EARLY_ERRORS)
    earlyErrors.push(event.error ?? event.message)
}

function onRejection(event: PromiseRejectionEvent) {
  if (earlyErrors.length < MAX_EARLY_ERRORS)
    earlyErrors.push(event.reason)
}

/** 加载并启动错误报告（只启动一次）；补报加载前记下的异常与跳转 */
export function loadTelemetry(): Promise<TelemetryClient> {
  loading ??= import('./client').then((mod) => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    mod.startTelemetry()
    for (const [url, type] of earlyNavigations.splice(0))
      mod.recordNavigation(url, type)
    for (const error of earlyErrors.splice(0))
      mod.captureEarlyError(error)
    client = mod
    return mod
  })
  return loading
}

/** 页面脚本执行前调用（instrumentation-client.ts）：先记下异常，空闲时再加载 SDK */
export function scheduleTelemetry() {
  if (typeof window === 'undefined')
    return
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  const start = () => {
    void loadTelemetry().catch(() => {
      // 代码块加载失败（离线、发版后旧代码块被清理）：这一页不报错误
    })
  }
  if (typeof window.requestIdleCallback === 'function')
    window.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS })
  else
    window.setTimeout(start, 1500)
}

/** 路由跳转记为面包屑；SDK 还没加载时先记下 */
export function recordNavigationLazy(url: string, navigationType: string) {
  if (client) {
    client.recordNavigation(url, navigationType)
    return
  }
  if (earlyNavigations.length >= MAX_EARLY_NAVIGATIONS)
    earlyNavigations.shift()
  earlyNavigations.push([url, navigationType])
}
