import type { NextRequest } from 'next/server'
import { BACKEND_URL } from '@/api/client'
import { backendRequestHeaders, backendResponse, REQUEST_ID_HEADER } from '@/lib/backend-proxy'
import { createRateBudget } from '@/lib/rate-budget'
import { symbolicateEnvelope } from '@/lib/telemetry/symbolicate'

// 错误报告的上报入口（Sentry SDK 的 tunnel）：先在这里把浏览器调用栈还原到源码位置（source map 只在服务端），再转给后端；
// 比 /api/v1/[...path] 的通用转发优先匹配；只有 POST，按请求处理

// 与后端 service.MaxErrorEnvelopeSize 一致
const MAX_BODY_SIZE = 256 << 10

// 调用栈还原要读 source map、拆源码，比较耗 CPU，而这里在后端按 IP 限流之前：本进程每分钟最多还原这么多次，
// 超出时原样转发（后端照常限流与保存，只是调用栈停留在压缩后的位置）
const takeSymbolicateBudget = createRateBudget(60, 60_000)

export async function POST(request: NextRequest) {
  let body = await request.text()
  if (body.length > MAX_BODY_SIZE)
    return new Response(null, { status: 413 })
  if (takeSymbolicateBudget()) {
    try {
      body = await symbolicateEnvelope(body)
    }
    catch {
      // 格式不对时原样转发，由后端拒绝
    }
  }
  const headers = backendRequestHeaders(request)
  headers.delete('content-length')
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/telemetry/envelope`, { method: 'POST', headers, body, cache: 'no-store' })
    return backendResponse(upstream, headers.get(REQUEST_ID_HEADER) ?? undefined)
  }
  catch {
    return new Response('Bad Gateway', { status: 502 })
  }
}
