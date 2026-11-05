// Next.js 启动时调用一次：在 Node.js 运行时启动本实例的运行时指标采集（见 lib/server-metrics.ts）
export async function register() {
  // 本文件也会按 Edge 运行时打包，那里没有 node:process，只能读全局的 process.env
  // eslint-disable-next-line node/prefer-global/process
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startServerMetrics } = await import('@/lib/server-metrics')
    startServerMetrics()
  }
}
