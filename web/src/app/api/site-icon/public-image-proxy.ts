import type { DecodedIconInput } from './icon-render'
import type { SiteInfo } from '@/utils/common/siteinfo'
import { Buffer } from 'node:buffer'
import { connection } from 'next/server'
import { getSiteInfo } from '@/api/misc'
import { getCachedSiteInfoOrFallback } from '@/api/misc.server'
import { getSharp, loadSafeIconSource, MAX_INPUT_PIXELS } from './icon-render'

const MEMORY_CACHE_TTL_MS = 60 * 60 * 1000
const FRESH_SITE_INFO_TTL_MS = 5_000
const MAX_PROXY_EDGE = 256
const PROXY_CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400'

interface CachedImage {
  key: string
  bytes: Uint8Array
  mime: string
  expiresAt: number
}

const slotCache = new Map<string, CachedImage>()
const inflightMap = new Map<string, { key: string, promise: Promise<{ bytes: Uint8Array, mime: string } | null> }>()

let freshSiteInfoCache: { value: SiteInfo | null, expiresAt: number } | null = null
let freshSiteInfoInflight: Promise<SiteInfo | null> | null = null

async function getFreshSiteInfoCoalesced(): Promise<SiteInfo | null> {
  const now = Date.now()
  if (freshSiteInfoCache && freshSiteInfoCache.expiresAt > now)
    return freshSiteInfoCache.value

  if (!freshSiteInfoInflight) {
    const promise = getSiteInfo()
      .then(res => res.data)
      .catch(() => null)
      .then((fresh) => {
        freshSiteInfoCache = { value: fresh, expiresAt: Date.now() + FRESH_SITE_INFO_TTL_MS }
        return fresh
      })
      .finally(() => {
        if (freshSiteInfoInflight === promise)
          freshSiteInfoInflight = null
      })
    freshSiteInfoInflight = promise
  }
  return freshSiteInfoInflight
}

/** 防止站点配置误填自身固定反代路径导致循环回源 */
export function isSelfProxyPath(rawUrl: string): boolean {
  const trimmed = rawUrl.trim()
  if (!trimmed)
    return false
  try {
    const pathname = trimmed.startsWith('/') ? trimmed.split(/[?#]/, 1)[0] : new URL(trimmed).pathname
    return pathname === '/avatar.png' || pathname === '/site-icon.png'
  }
  catch {
    return false
  }
}

/**
 * 不裁剪圆角、保留原比例的小图压缩输出：
 * - SVG 原样返回
 * - 位图或 .ico 解包帧通过 sharp 等比缩放至最长边不超过 256px（不裁剪、不放大），输出 PNG；sharp 不可用时原样返回
 */
async function encodeBoundedImage(decoded: DecodedIconInput): Promise<{ bytes: Uint8Array, mime: string } | null> {
  if (decoded.kind === 'encoded' && decoded.mime === 'image/svg+xml')
    return { bytes: new Uint8Array(decoded.bytes), mime: 'image/svg+xml' }

  const sharp = getSharp()
  if (!sharp) {
    if (decoded.kind === 'encoded')
      return { bytes: new Uint8Array(decoded.bytes), mime: decoded.mime }
    return null
  }

  try {
    const pipeline = decoded.kind === 'raw'
      ? sharp(decoded.rgba, {
          raw: { width: decoded.width, height: decoded.height, channels: 4 },
          limitInputPixels: MAX_INPUT_PIXELS,
        })
      : sharp(decoded.bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate()

    const out = await pipeline
      .resize(MAX_PROXY_EDGE, MAX_PROXY_EDGE, { fit: 'inside', withoutEnlargement: true } as unknown as { fit?: 'cover' })
      .png({ compressionLevel: 9 })
      .toBuffer()

    return { bytes: new Uint8Array(out), mime: 'image/png' }
  }
  catch {
    if (decoded.kind === 'encoded')
      return { bytes: new Uint8Array(decoded.bytes), mime: decoded.mime }
    return null
  }
}

async function getOrFetchSlotImage(slotKey: string, sourceUrl: string, baseUrl?: string): Promise<{ bytes: Uint8Array, mime: string } | null> {
  const now = Date.now()
  const cached = slotCache.get(slotKey)
  if (cached && cached.key === sourceUrl && cached.expiresAt > now)
    return { bytes: cached.bytes, mime: cached.mime }

  let inflight = inflightMap.get(slotKey)
  if (!inflight || inflight.key !== sourceUrl) {
    const promise = (async () => {
      const loaded = await loadSafeIconSource(sourceUrl, baseUrl)
      if (!loaded)
        return null
      return encodeBoundedImage(loaded.decoded)
    })().finally(() => {
      if (inflightMap.get(slotKey)?.promise === promise)
        inflightMap.delete(slotKey)
    })
    inflight = { key: sourceUrl, promise }
    inflightMap.set(slotKey, inflight)
  }

  const result = await inflight.promise
  if (result && (!inflightMap.has(slotKey) || inflightMap.get(slotKey)?.key === sourceUrl)) {
    slotCache.set(slotKey, {
      key: sourceUrl,
      bytes: result.bytes,
      mime: result.mime,
      expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
    })
  }
  return result
}

/**
 * 为友链等外部引用提供固定路径的轻量图片反代（200 OK + 短缓存，不裁圆角）
 */
export async function serveFixedPublicImage(
  slotKey: 'avatar' | 'site-icon',
  pickSource: (siteInfo: SiteInfo) => string,
): Promise<Response> {
  await connection()
  let siteInfo = await getCachedSiteInfoOrFallback()
  let sourceUrl = pickSource(siteInfo).trim()

  if (!sourceUrl || isSelfProxyPath(sourceUrl)) {
    const fresh = await getFreshSiteInfoCoalesced()
    if (fresh) {
      siteInfo = fresh
      sourceUrl = pickSource(fresh).trim()
    }
  }

  if (!sourceUrl || isSelfProxyPath(sourceUrl))
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

  const image = await getOrFetchSlotImage(slotKey, sourceUrl, siteInfo.baseUrl)
  if (!image)
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

  return new Response(Buffer.from(image.bytes), {
    status: 200,
    headers: {
      'Content-Type': image.mime,
      'Cache-Control': PROXY_CACHE_CONTROL,
    },
  })
}
