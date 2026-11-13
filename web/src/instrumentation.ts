import type { Instrumentation } from 'next'

// Next.js 启动时调用一次：在 Node.js 运行时启动本实例的运行时指标采集（见 lib/server-metrics.ts）
export async function register() {
  // 本文件也会按 Edge 运行时打包，那里没有 node:process，只能读全局的 process.env
  // eslint-disable-next-line node/prefer-global/process
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // eslint-disable-next-line node/prefer-global/process
    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) {
      const { registerOTel } = await import('@/lib/telemetry/otel.node')
      registerOTel()
    }
    const { startServerMetrics } = await import('@/lib/server-metrics')
    startServerMetrics()
  }
}

// 服务端渲染、路由处理函数与 Server Action 中的错误记入错误报告（见 lib/telemetry/server.ts），只在 Node.js 运行时上报
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  // eslint-disable-next-line node/prefer-global/process
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { reportServerError } = await import('@/lib/telemetry/server')
    await reportServerError(...args)
  }
}
