import { recordNavigation, startTelemetry } from '@/lib/telemetry/client'

// 页面脚本执行前初始化错误报告（见 lib/telemetry/client.ts）
startTelemetry()

export function onRouterTransitionStart(url: string, navigationType: 'push' | 'replace' | 'traverse') {
  recordNavigation(url, navigationType)
}
