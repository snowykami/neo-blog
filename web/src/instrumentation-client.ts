import { recordNavigationLazy, scheduleTelemetry } from '@/lib/telemetry/loader'

// 页面脚本执行前开始记录错误，SDK 在浏览器空闲时再加载（见 lib/telemetry/loader.ts）
scheduleTelemetry()

export function onRouterTransitionStart(url: string, navigationType: 'push' | 'replace' | 'traverse') {
  recordNavigationLazy(url, navigationType)
}
