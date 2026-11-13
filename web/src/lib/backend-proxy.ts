import type { NextRequest } from 'next/server'
import { context, propagation } from '@opentelemetry/api'

// 逐跳头不能转发；浏览器的 accept-encoding 也不转发，见 backendRequestHeaders
const REQUEST_SKIP_HEADERS = ['host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'expect', 'accept-encoding']
const RESPONSE_SKIP_HEADERS = ['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length']

/** 请求 ID 的请求头 / 响应头：转发时生成或透传给后端，后端沿用并写回响应，前后端日志与错误报告据此串起同一个请求 */
export const REQUEST_ID_HEADER = 'x-request-id'
// 与后端 ctxutils.ValidRequestID 一致：8~64 位字母、数字与 - _ . :，其余（可能伪造日志行的内容）一律重新生成
const REQUEST_ID_PATTERN = /^[\w.:-]{8,64}$/

export function isValidRequestId(id: string | null | undefined): id is string {
  return !!id && REQUEST_ID_PATTERN.test(id)
}

/** 新的请求 ID（32 位十六进制，与后端生成的格式一致） */
export function newRequestId() {
  return crypto.randomUUID().replaceAll('-', '')
}

/** 本次请求的 ID：前面的反向代理 / 负载均衡带来的合法 ID（请求头 X-Request-ID 的值）沿用，否则生成新的 */
export function requestIdOf(given: string | null | undefined) {
  return isValidRequestId(given) ? given : newRequestId()
}

/**
 * 转发给后端的请求头：去掉逐跳头，并与 Next.js rewrites 一致地把浏览器访问的主机与协议放进 X-Forwarded-*（后端据此判断请求来源）；
 * 带上请求 ID（见 requestIdOf），调用方可从返回值的 x-request-id 读取
 */
export function backendRequestHeaders(request: NextRequest) {
  const headers = new Headers(request.headers)
  for (const name of REQUEST_SKIP_HEADERS)
    headers.delete(name)
  // 只删掉 accept-encoding 不够：Node 的 fetch（undici）会自己补上 gzip, deflate 并自动解压，
  // 后端压一遍、这里解一遍、Next 再为浏览器压一遍，后端那次纯属浪费 CPU。
  // 显式声明 identity 让后端返回原文（undici 只在请求没有 accept-encoding 时才补），压缩交给 Next
  headers.set('accept-encoding', 'identity')
  const host = request.headers.get('host')
  if (!headers.has('x-forwarded-host') && host)
    headers.set('x-forwarded-host', host)
  if (!headers.has('x-forwarded-proto'))
    headers.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''))
  headers.set(REQUEST_ID_HEADER, requestIdOf(request.headers.get(REQUEST_ID_HEADER)))
  if (!headers.has('traceparent')) {
    const carrier: Record<string, string> = {}
    propagation.inject(context.active(), carrier)
    for (const [k, v] of Object.entries(carrier)) {
      if (!headers.has(k))
        headers.set(k, v)
    }
  }
  return headers
}

/**
 * 事件流（SSE）的响应体：上游中途断开（浏览器关掉页面时同步中止了到后端的请求、后端重启）时正常结束，而不是让流出错。
 * 出错的流会被 Next 记成服务端错误（failed to pipe response）上报；SSE 断开是常态，浏览器的 EventSource 会自动重连
 */
function endQuietlyOnError(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done)
          controller.close()
        else
          controller.enqueue(value)
      }
      catch {
        controller.close()
      }
    },
    cancel(reason) {
      return reader.cancel(reason).catch(() => {})
    },
  })
}

/** 把后端的响应原样交回浏览器（去掉逐跳头与编码相关的头）；后端没有回写请求 ID 时补上本次转发用的 */
export function backendResponse(upstream: Response, requestId?: string) {
  const headers = new Headers(upstream.headers)
  for (const name of RESPONSE_SKIP_HEADERS)
    headers.delete(name)
  if (requestId && !headers.has(REQUEST_ID_HEADER))
    headers.set(REQUEST_ID_HEADER, requestId)
  const isEventStream = headers.get('content-type')?.includes('text/event-stream')
  const body = isEventStream && upstream.body ? endQuietlyOnError(upstream.body) : upstream.body
  return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers })
}
