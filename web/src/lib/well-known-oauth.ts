import type { NextRequest } from 'next/server'
import { connection } from 'next/server'
import { BACKEND_URL } from '@/api/client'
import { backendRequestHeaders, backendResponse, REQUEST_ID_HEADER } from '@/lib/backend-proxy'

const ALLOWED_WELL_KNOWN_ROOTS = new Set([
  'oauth-protected-resource',
  'oauth-authorization-server',
])

/**
 * 将经 next.config.ts 内部 rewrites 映射进来的 /.well-known/oauth-* 请求在运行时转发至 Go 后端。
 * 不直接在 next.config.ts rewrites 写外部 BACKEND_URL，确保 standalone 容器启动时注入的 BACKEND_URL 动态生效。
 */
export async function forwardWellKnownOAuth(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  await connection()
  const { path } = await context.params
  if (!Array.isArray(path) || path.length === 0 || !ALLOWED_WELL_KNOWN_ROOTS.has(path[0]))
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

  const upstreamPath = `/.well-known/${path.map(encodeURIComponent).join('/')}`
  const { search } = request.nextUrl
  const headers = backendRequestHeaders(request)
  const requestId = headers.get(REQUEST_ID_HEADER) ?? ''

  try {
    const upstream = await fetch(`${BACKEND_URL}${upstreamPath}${search}`, {
      method: request.method,
      headers,
      redirect: 'manual',
      cache: 'no-store',
      signal: request.signal,
    })
    return backendResponse(upstream, requestId)
  }
  catch (error) {
    if (request.signal.aborted)
      return new Response(null, { status: 499, headers: { [REQUEST_ID_HEADER]: requestId } })
    console.error(`Failed to proxy ${request.method} ${upstreamPath} to ${BACKEND_URL} (request id ${requestId})`, error)
    return new Response('Bad Gateway', { status: 502, headers: { 'Cache-Control': 'no-store', [REQUEST_ID_HEADER]: requestId } })
  }
}
