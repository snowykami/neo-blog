import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import { AsyncLocalStorage } from 'node:async_hooks'
import http from 'node:http'
import { isConsolePath, splitLocalePrefix } from '@/i18n/routing'

export type RendererLevel = 'M' | 'R' | 'C'

export interface RendererStore {
  renderer: RendererLevel | null
}

// 与 cache-tag-versions.mjs 共用同一个 Symbol 键：instrumentation 会被打包，cache-handler.mjs 在运行时直接加载
const RENDERER_ALS_KEY = Symbol.for('neo-blog.cache-renderer')
const HOOK_STATE_KEY = Symbol.for('neo-blog.renderer-header-hook')

const EXCLUDED_FIRST_SEGMENTS = new Set([
  'api',
  '_next',
  '_vercel',
  'healthz',
  'readyz',
  'fonts',
  'image',
  'console',
  'rss',
  'rss.xml',
  'feed',
  'feed.xml',
  'sitemap.xml',
  'robots.txt',
  'avatar.png',
  'site-icon.png',
  'favicon.ico',
])

const LEGACY_CONSOLE_PATH_RE = /^\/[a-z]{2}(?:-[a-z]{2})?\/console(?:\/|$)/i
const PAGE_CONTENT_TYPE_RE = /^text\/(?:html|x-component)\b/i

function rendererStorage(): AsyncLocalStorage<RendererStore> {
  const holder = globalThis as unknown as Record<symbol, AsyncLocalStorage<RendererStore> | undefined>
  holder[RENDERER_ALS_KEY] ??= new AsyncLocalStorage<RendererStore>()
  return holder[RENDERER_ALS_KEY]
}

/**
 * 判断请求是否属于需要输出 `renderer` 诊断头的前台公开页面路由（HTML 文档与 `?_rsc=` / `.rsc` 路由请求）。
 * 排除 `/api/*`、`/_next/*`、`/healthz`、后台 `/console/*`、静态资源及分享图路由。
 */
export function isPublicPageRequest(req: Pick<IncomingMessage, 'method' | 'url' | 'headers'>): boolean {
  const method = req.method?.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD')
    return false

  const headers: IncomingHttpHeaders | undefined = req.headers
  if (headers?.['next-action'] !== undefined)
    return false

  const rawUrl = req.url ?? ''
  if (!rawUrl.startsWith('/') || rawUrl.startsWith('//'))
    return false

  const qIdx = rawUrl.indexOf('?')
  const pathname = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl
  const firstSeg = (pathname.slice(1).split('/', 1)[0] ?? '').toLowerCase()
  if (EXCLUDED_FIRST_SEGMENTS.has(firstSeg))
    return false

  if (LEGACY_CONSOLE_PATH_RE.test(pathname))
    return false

  const stripped = splitLocalePrefix(pathname)
  if (isConsolePath(stripped.pathname))
    return false

  // 文章分享图（route.tsx 返回 PNG）不属于页面文档或 RSC 路由响应
  if (stripped.pathname.endsWith('/share-image') || stripped.pathname.endsWith('/share-image/'))
    return false

  return true
}

function readContentTypeFromWriteHeadArgs(args: unknown[]): string | undefined {
  const candidate = typeof args[1] === 'string' ? args[2] : args[1]
  if (!candidate || typeof candidate !== 'object')
    return undefined

  if (Array.isArray(candidate)) {
    for (let i = 0; i < candidate.length; i++) {
      const item = candidate[i]
      if (Array.isArray(item) && typeof item[0] === 'string' && item[0].toLowerCase() === 'content-type')
        return String(item[1] ?? '')
      if (typeof item === 'string' && item.toLowerCase() === 'content-type' && i + 1 < candidate.length)
        return String(candidate[i + 1] ?? '')
    }
    return undefined
  }

  for (const [key, val] of Object.entries(candidate as OutgoingHttpHeaders)) {
    if (key.toLowerCase() === 'content-type' && val !== undefined)
      return Array.isArray(val) ? val.join(', ') : String(val)
  }
  return undefined
}

function extractContentType(res: ServerResponse, writeHeadArgs: unknown[]): string {
  const fromArgs = readContentTypeFromWriteHeadArgs(writeHeadArgs)
  if (fromArgs !== undefined)
    return fromArgs
  const existing = res.getHeader('content-type')
  if (Array.isArray(existing))
    return existing.join(', ')
  return typeof existing === 'string' ? existing : ''
}

/**
 * 在响应头实际写出前按当前请求上下文计算并注入 `renderer: M | R | C`（不修改缓存条目自身的 headers，杜绝跨请求串号）
 */
export function resolveRendererHeaderValue(
  store: RendererStore | undefined,
  statusCode: number,
  contentType: string,
): RendererLevel | null {
  if (!store)
    return null

  // 3xx 跳转 / 304 协商缓存：仅当本次请求实际经过了 cache-handler（如已缓存的文章 ID → slug 308 跳转或页面 ETag 304）时才输出；
  // proxy.ts 在进入路由前直接返回的纯规则重定向不输出 renderer
  if (statusCode >= 300 && statusCode < 400)
    return store.renderer

  if (!PAGE_CONTENT_TYPE_RE.test(contentType.trim()))
    return null

  return store.renderer ?? 'C'
}

function wrapServerRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => boolean,
): boolean {
  if (!isPublicPageRequest(req))
    return next()

  const storage = rendererStorage()
  const origWriteHead = res.writeHead
  res.writeHead = function writeHeadWithRenderer(this: ServerResponse, ...args: unknown[]) {
    if (!this.headersSent) {
      const status = typeof args[0] === 'number' ? args[0] : this.statusCode
      const contentType = extractContentType(this, args)
      const level = resolveRendererHeaderValue(storage.getStore(), status, contentType)
      if (level)
        this.setHeader('renderer', level)
    }
    return origWriteHead.apply(this, args as Parameters<typeof origWriteHead>)
  } as typeof origWriteHead

  return storage.run({ renderer: null }, next)
}

/**
 * 在 Node/Bun HTTP 服务上挂载公开页面 `renderer` 诊断响应头钩子（由 instrumentation.ts 启动时注册一次，幂等）
 */
export function startRendererHeader() {
  const holder = globalThis as unknown as Record<symbol, boolean | undefined>
  if (holder[HOOK_STATE_KEY])
    return
  holder[HOOK_STATE_KEY] = true

  const originalEmit = http.Server.prototype.emit
  http.Server.prototype.emit = function emitWithRendererHeader(this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event === 'request') {
      const req = args[0] as IncomingMessage
      const res = args[1] as ServerResponse
      return wrapServerRequest(req, res, () =>
        Reflect.apply(originalEmit, this, [event, ...args]) as boolean)
    }
    return Reflect.apply(originalEmit, this, [event, ...args]) as boolean
  } as typeof originalEmit
}
