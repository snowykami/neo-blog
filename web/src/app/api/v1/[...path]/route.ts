import type { NextRequest } from 'next/server'
import { BACKEND_URL } from '@/api/client'
import { backendRequestHeaders, backendResponse } from '@/lib/backend-proxy'

// 浏览器请求的 /api/v1/* 在运行时转发到后端。
// 不用 next.config 的 rewrites：standalone 构建会把 rewrites 目标写死进产物，部署时设置的 BACKEND_URL 不生效；
// 也不用 proxy.ts：它会把请求体整体缓冲进内存（默认上限 10MB），大文件上传会被截断。
export const dynamic = 'force-dynamic'

// AI 用户 Runner 的接口与 AI 用户专用 MCP 只供 Runner 直连后端，不经前端转发
const DIRECT_ONLY = /^\/api\/v1\/(?:agent-runner|agent-mcp)(?:\/|$)/

async function forward(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  if (DIRECT_ONLY.test(pathname))
    return new Response('Not Found', { status: 404 })

  const headers = backendRequestHeaders(request)
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

  return backendResponse(upstream)
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
