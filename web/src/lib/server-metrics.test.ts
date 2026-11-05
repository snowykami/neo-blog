// @vitest-environment node
import type { AddressInfo } from 'node:net'
import http from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import { getServerMetrics, startServerMetrics } from './server-metrics'

// 包装 http.Server 的 emit 后，任意 HTTP 服务（包括 Next.js 自己创建的）的请求与连接都会被统计；探针请求不计入
describe('server metrics', () => {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const server = http.createServer((req, res) => {
    if (req.url === '/slow')
      void held.then(() => res.end('ok'))
    else
      res.end('ok')
  })

  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

  it('counts in-flight requests and open connections', async () => {
    startServerMetrics()
    startServerMetrics() // 重复调用不会重复包装
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const { port } = server.address() as AddressInfo
    const base = `http://127.0.0.1:${port}`
    const before = getServerMetrics().instance.core

    const slow = fetch(`${base}/slow`)
    await fetch(`${base}/healthz`)
    await new Promise(resolve => setTimeout(resolve, 50))
    const during = getServerMetrics()
    expect(during.shared).toBe(false) // 没有配置 REDIS_URL
    expect(during.instance.core.inflight_requests - before.inflight_requests).toBe(1)
    expect(during.instance.core.connections).toBeGreaterThanOrEqual(1)
    expect(during.instance.metrics.nodeVersion).toBe(process.version)

    release()
    await (await slow).text()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(getServerMetrics().instance.core.inflight_requests).toBe(before.inflight_requests)
  })
})
