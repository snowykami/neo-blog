import type { NextRequest } from 'next/server'

// 逐跳头不能转发；accept-encoding 去掉后由后端返回原文，避免 fetch 自动解压后与 content-encoding 不一致
const REQUEST_SKIP_HEADERS = ['host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'expect', 'accept-encoding']
const RESPONSE_SKIP_HEADERS = ['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length']

/** 转发给后端的请求头：去掉逐跳头，并与 Next.js rewrites 一致地把浏览器访问的主机与协议放进 X-Forwarded-*（后端据此判断请求来源） */
export function backendRequestHeaders(request: NextRequest) {
  const headers = new Headers(request.headers)
  for (const name of REQUEST_SKIP_HEADERS)
    headers.delete(name)
  const host = request.headers.get('host')
  if (!headers.has('x-forwarded-host') && host)
    headers.set('x-forwarded-host', host)
  if (!headers.has('x-forwarded-proto'))
    headers.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''))
  return headers
}

/** 把后端的响应原样交回浏览器（去掉逐跳头与编码相关的头） */
export function backendResponse(upstream: Response) {
  const headers = new Headers(upstream.headers)
  for (const name of RESPONSE_SKIP_HEADERS)
    headers.delete(name)
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
}
