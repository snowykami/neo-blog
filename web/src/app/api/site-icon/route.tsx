import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { ImageResponse } from 'next/og'
import { connection } from 'next/server'
import { BACKEND_URL } from '@/api/client'
import { getCachedSiteInfoOrFallback } from '@/api/misc.server'
import { normalizeSiteIconRadius, siteIconVersionHash } from '@/utils/common/siteinfo'

const ICON_SIZE = 64
const FETCH_TIMEOUT_MS = 8_000
const MAX_SOURCE_BYTES = 8 * 1024 * 1024
const MEMORY_CACHE_TTL_MS = 60 * 60 * 1000
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const SHORT_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600'

interface SharpInstance {
  resize: (width: number, height: number, options?: { fit?: 'cover' }) => SharpInstance
  ensureAlpha: () => SharpInstance
  composite: (overlays: Array<{ input: Buffer, blend: 'dest-in' }>) => SharpInstance
  png: (options?: { compressionLevel?: number }) => SharpInstance
  toBuffer: () => Promise<Buffer>
}
type SharpFactory = (input: Buffer) => SharpInstance

let cachedSharp: SharpFactory | false | undefined

/**
 * 复用 Next.js 自身依赖树内的 sharp（standalone 镜像中已随 next/image 一并打包，无需额外装包）；
 * 极端环境未能加载时回退到 next/og ImageResponse
 */
function getSharp(): SharpFactory | null {
  if (cachedSharp !== undefined)
    return cachedSharp || null
  try {
    const localRequire = createRequire(import.meta.url)
    const nextRequire = createRequire(localRequire.resolve('next/package.json'))
    cachedSharp = nextRequire('sharp') as SharpFactory
    return cachedSharp
  }
  catch {
    cachedSharp = false
    return null
  }
}

// 站点同一时刻只有一份生效的 (icon, radius) 组合：单槽内存缓存 + 并发合并，占用固定约 3KB，无内存增长风险
let cachedEntry: { key: string, bytes: Uint8Array, expiresAt: number } | null = null
let inflightRender: { key: string, promise: Promise<Uint8Array | null> } | null = null

function sniffMime(bytes: Buffer, fallbackType: string) {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8)
    return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50)
    return 'image/png'
  if (bytes[0] === 0x47 && bytes[1] === 0x49)
    return 'image/gif'
  if (bytes.length > 11 && bytes[8] === 0x57 && bytes[9] === 0x45)
    return 'image/webp'
  return fallbackType.split(';')[0]?.trim() || 'image/png'
}

function resolveIconFetchUrl(icon: string, baseUrl: string | undefined, requestUrl: string): string {
  // 站内上传文件（/api/v1/file/...）直连内部后端，避开公网回环与外层网关开销
  if (icon.startsWith('/api/'))
    return `${BACKEND_URL}${icon}`
  if (/^https?:\/\//i.test(icon))
    return icon
  const origin = baseUrl?.replace(/\/+$/, '') || new URL(requestUrl).origin
  return `${origin}/${icon.replace(/^\/+/, '')}`
}

async function renderRoundedIcon(sourceBytes: Buffer, mime: string, radiusPercent: number): Promise<Uint8Array> {
  const rx = Math.round(ICON_SIZE * radiusPercent) / 100
  const sharp = getSharp()
  if (sharp) {
    const maskSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}"><rect width="${ICON_SIZE}" height="${ICON_SIZE}" rx="${rx}" ry="${rx}" fill="#fff"/></svg>`,
    )
    const out = await sharp(sourceBytes)
      .resize(ICON_SIZE, ICON_SIZE, { fit: 'cover' })
      .ensureAlpha()
      .composite([{ input: maskSvg, blend: 'dest-in' }])
      .png({ compressionLevel: 9 })
      .toBuffer()
    return new Uint8Array(out)
  }

  const dataUrl = `data:${mime};base64,${sourceBytes.toString('base64')}`
  const res = new ImageResponse(
    (
      <div
        style={{
          width: ICON_SIZE,
          height: ICON_SIZE,
          display: 'flex',
          overflow: 'hidden',
          borderRadius: rx,
        }}
      >
        {/* eslint-disable-next-line next/no-img-element */}
        <img
          src={dataUrl}
          alt=""
          width={ICON_SIZE}
          height={ICON_SIZE}
          style={{ width: ICON_SIZE, height: ICON_SIZE, objectFit: 'cover', borderRadius: rx }}
        />
      </div>
    ),
    { width: ICON_SIZE, height: ICON_SIZE },
  )
  return new Uint8Array(await res.arrayBuffer())
}

async function loadAndRenderIcon(icon: string, radius: number, baseUrl: string | undefined, requestUrl: string): Promise<Uint8Array | null> {
  const fetchUrl = resolveIconFetchUrl(icon, baseUrl, requestUrl)
  try {
    const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !contentType.startsWith('image/'))
      return null
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_SOURCE_BYTES)
      return null
    return await renderRoundedIcon(bytes, sniffMime(bytes, contentType), radius)
  }
  catch {
    return null
  }
}

export async function GET(request: Request) {
  await connection()
  const siteInfo = await getCachedSiteInfoOrFallback()
  // 严格只从服务端站点配置读取源图与圆角，不接受查询参数传入外部 URL（杜绝 SSRF 与缓存膨胀）
  const icon = siteInfo.metadata?.icon?.trim()
  if (!icon)
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

  const radius = normalizeSiteIconRadius(siteInfo.metadata?.iconRadius)
  const key = `${icon}|${radius}`
  const now = Date.now()

  let pngBytes: Uint8Array | null = null
  if (cachedEntry && cachedEntry.key === key && cachedEntry.expiresAt > now) {
    pngBytes = cachedEntry.bytes
  }
  else {
    if (!inflightRender || inflightRender.key !== key) {
      const promise = loadAndRenderIcon(icon, radius, siteInfo.baseUrl, request.url).finally(() => {
        if (inflightRender?.promise === promise)
          inflightRender = null
      })
      inflightRender = { key, promise }
    }
    pngBytes = await inflightRender.promise
    if (pngBytes)
      cachedEntry = { key, bytes: pngBytes, expiresAt: now + MEMORY_CACHE_TTL_MS }
  }

  if (!pngBytes)
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } })

  // 查询参数与当前生效配置指纹一致时下发一年不可变强缓存；否则只给短缓存避免旧地址污染 CDN
  const searchParams = new URL(request.url).searchParams
  const versionMatch = searchParams.get('r') === String(radius) && searchParams.get('v') === siteIconVersionHash(icon)

  return new Response(Buffer.from(pngBytes), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': versionMatch ? IMMUTABLE_CACHE_CONTROL : SHORT_CACHE_CONTROL,
    },
  })
}
