import type { Instrumentation } from 'next'
import process from 'node:process'
import { BACKEND_URL } from '@/api/client'
import { REQUEST_ID_HEADER, requestIdOf } from '@/lib/backend-proxy'
import { symbolicateServerFrames } from './symbolicate'

/**
 * Next.js 服务端的错误报告：服务端组件、路由处理函数、Server Action 中抛出的错误由 instrumentation.ts 的 onRequestError 交给这里，
 * 按 Sentry envelope 格式（platform 为 node，后端据此记为服务端错误）直接发给后端，不经过浏览器。
 * 读者的 IP、UA 与请求标识（DNT / GPC）随请求头转给后端，与浏览器上报一致；Cookie 只转发访客与登录凭据。
 * 请求 ID：出错的请求带有合法的 X-Request-ID（前面的反向代理生成）时沿用，否则新生成；记在事件标签 request_id 里，
 * 并作为这次上报请求的 X-Request-ID，后端访问日志里能找到对应的上报
 */

const REPORT_TIMEOUT_MS = 3000
const FRAME_LIMIT = 40
// V8 调用栈的一帧：at 函数 (文件:行:列) 或 at 文件:行:列
const FRAME_PATTERN = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/
// 转给后端的请求头：客户端地址、UA、请勿追踪与 Cookie（后端只读访客与登录凭据）
const FORWARD_HEADERS = ['x-forwarded-for', 'x-real-ip', 'user-agent', 'dnt', 'sec-gpc', 'cookie']

interface Frame {
  filename: string
  function?: string
  lineno: number
  colno: number
  in_app: boolean
}

/** 解析 V8 调用栈，返回从最外层到出错处的帧（与 Sentry 的顺序一致） */
function parseStack(stack: string | undefined): Frame[] {
  const frames: Frame[] = []
  for (const line of (stack ?? '').split('\n').slice(1)) {
    const m = FRAME_PATTERN.exec(line)
    if (!m)
      continue
    const filename = m[2].replace(/^file:\/\//, '')
    frames.push({
      filename,
      function: m[1],
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes('node_modules') && !filename.startsWith('node:'),
    })
  }
  return frames.slice(0, FRAME_LIMIT).reverse()
}

function header(headers: NodeJS.Dict<string | string[]>, name: string) {
  const value = headers[name]
  return Array.isArray(value) ? value.join(', ') : value
}

export async function reportServerError(...[error, request, context]: Parameters<Instrumentation.onRequestError>) {
  const err = error instanceof Error ? error : new Error(String(error))
  const digest = (err as Error & { digest?: string }).digest
  const eventId = crypto.randomUUID().replaceAll('-', '')
  const userAgent = header(request.headers, 'user-agent') ?? ''
  const requestId = requestIdOf(header(request.headers, REQUEST_ID_HEADER))
  const frames = parseStack(err.stack)
  await symbolicateServerFrames(frames).catch(() => {})
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    release: process.env.NEXT_PUBLIC_APP_VERSION?.trim() || undefined,
    environment: process.env.NODE_ENV,
    exception: { values: [{ type: err.name, value: err.message, stacktrace: { frames } }] },
    tags: { source: 'server', method: request.method, route_type: context.routeType, request_id: requestId, ...(digest && { digest }) },
    request: { url: request.path, headers: { 'User-Agent': userAgent } },
    contexts: { next: { router_kind: context.routerKind, route_path: context.routePath, route_type: context.routeType, render_source: context.renderSource } },
  }
  const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`
  const headers = new Headers({ 'content-type': 'text/plain;charset=UTF-8', [REQUEST_ID_HEADER]: requestId })
  for (const name of FORWARD_HEADERS) {
    const value = header(request.headers, name)
    if (value)
      headers.set(name, value)
  }
  try {
    await fetch(`${BACKEND_URL}/api/v1/telemetry/envelope`, { method: 'POST', headers, body, signal: AbortSignal.timeout(REPORT_TIMEOUT_MS) })
  }
  catch {
    // 后端不可用时只能放弃，不影响响应
  }
}
