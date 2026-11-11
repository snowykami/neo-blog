import type { NextRequest } from 'next/server'

// 逐跳头不能转发；浏览器的 accept-encoding 也不转发，见 backendRequestHeaders
const REQUEST_SKIP_HEADERS = ['host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'expect', 'accept-encoding']
const RESPONSE_SKIP_HEADERS = ['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length']

/** 转发给后端的请求头：去掉逐跳头，并与 Next.js rewrites 一致地把浏览器访问的主机与协议放进 X-Forwarded-*（后端据此判断请求来源） */
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

/** 把后端的响应原样交回浏览器（去掉逐跳头与编码相关的头） */
export function backendResponse(upstream: Response) {
  const headers = new Headers(upstream.headers)
  for (const name of RESPONSE_SKIP_HEADERS)
    headers.delete(name)
  const isEventStream = headers.get('content-type')?.includes('text/event-stream')
  const body = isEventStream && upstream.body ? endQuietlyOnError(upstream.body) : upstream.body
  return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers })
}
