import type { NextRequest } from 'next/server'
import { BACKEND_URL } from '@/api/client'

// 浏览器请求的 /api/v1/* 在运行时转发到后端。
// 不用 next.config 的 rewrites：standalone 构建会把 rewrites 目标写死进产物，部署时设置的 BACKEND_URL 不生效；
// 也不用 proxy.ts：它会把请求体整体缓冲进内存（默认上限 10MB），大文件上传会被截断。
export const dynamic = 'force-dynamic'

// AI 用户 Runner 的接口与 AI 用户专用 MCP 只供 Runner 直连后端，不经前端转发
const DIRECT_ONLY = /^\/api\/v1\/(?:agent-runner|agent-mcp)(?:\/|$)/

// 逐跳头不能转发；accept-encoding 去掉后由后端返回原文，避免 fetch 自动解压后与 content-encoding 不一致
const REQUEST_SKIP_HEADERS = ['host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'expect', 'accept-encoding']
const RESPONSE_SKIP_HEADERS = ['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length']

async function forward(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  if (DIRECT_ONLY.test(pathname))
    return new Response('Not Found', { status: 404 })

  const headers = new Headers(request.headers)
  for (const name of REQUEST_SKIP_HEADERS)
    headers.delete(name)
  // 与 Next.js rewrites 一致：把浏览器访问的主机与协议放进 X-Forwarded-*，后端据此判断请求来源
  const host = request.headers.get('host')
  if (!headers.has('x-forwarded-host') && host)
    headers.set('x-forwarded-host', host)
  if (!headers.has('x-forwarded-proto'))
    headers.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''))

  const hasBody = !['GET', 'HEAD'].includes(request.method)
  let upstream: Response
  try {
    upstream = await fetch(`${BACKEND_URL}${pathname}${search}`, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // 流式转发请求体，上传大文件时不在内存中整体缓冲
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
      cache: 'no-store',
      // 浏览器断开（如关闭 SSE）时同步中止到后端的请求
      signal: request.signal,
    } as RequestInit & { duplex?: 'half' })
  }
  catch (error) {
    if (request.signal.aborted)
      return new Response(null, { status: 499 })
    console.error(`Failed to proxy ${request.method} ${pathname} to ${BACKEND_URL}`, error)
    return new Response('Bad Gateway', { status: 502 })
  }

  const responseHeaders = new Headers(upstream.headers)
  for (const name of RESPONSE_SKIP_HEADERS)
    responseHeaders.delete(name)
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

export {
  forward as DELETE,
  forward as GET,
  forward as HEAD,
  forward as OPTIONS,
  forward as PATCH,
  forward as POST,
  forward as PUT,
}
