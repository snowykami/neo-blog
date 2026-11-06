import type { NextRequest } from 'next/server'
import { BACKEND_URL } from '@/api/client'
import { backendRequestHeaders, backendResponse } from '@/lib/backend-proxy'
import { symbolicateEnvelope } from '@/lib/telemetry/symbolicate'

// 错误报告的上报入口（Sentry SDK 的 tunnel）：先在这里把浏览器调用栈还原到源码位置（source map 只在服务端），再转给后端；
// 比 /api/v1/[...path] 的通用转发优先匹配
export const dynamic = 'force-dynamic'

// 与后端 service.MaxErrorEnvelopeSize 一致
const MAX_BODY_SIZE = 256 << 10

export async function POST(request: NextRequest) {
  let body = await request.text()
  if (body.length > MAX_BODY_SIZE)
    return new Response(null, { status: 413 })
  try {
    body = await symbolicateEnvelope(body)
  }
  catch {
    // 格式不对时原样转发，由后端拒绝
  }
  const headers = backendRequestHeaders(request)
  headers.delete('content-length')
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/telemetry/envelope`, { method: 'POST', headers, body, cache: 'no-store' })
    return backendResponse(upstream)
  }
  catch {
    return new Response('Bad Gateway', { status: 502 })
  }
}
