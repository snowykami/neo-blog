import { recordNavigationLazy, scheduleTelemetry } from '@/lib/telemetry/loader'

// 页面脚本执行前同步执行（由 Next 挂载）：严禁在此处静态导入 `@/lib/telemetry/client` 或 `@sentry/browser`，
// 必须只调轻量的 loader.ts，以确保浏览器空闲按需加载及禁用 Telemetry 时零开销短路
scheduleTelemetry()

export function onRouterTransitionStart(url: string, navigationType: 'push' | 'replace' | 'traverse') {
  recordNavigationLazy(url, navigationType)
}
