import type { DecodedIconInput } from './icon-render'
import type { SiteInfo } from '@/utils/common/siteinfo'
import { Buffer } from 'node:buffer'
import { ImageResponse } from 'next/og'
import { connection } from 'next/server'
import { getSiteInfo } from '@/api/misc'
import { getCachedSiteInfoOrFallback } from '@/api/misc.server'
import { normalizeSiteIconRadius } from '@/utils/common/siteinfo'
import {
  ICON_SIZE,
  IMAGE_RESPONSE_SAFE_MIMES,
  isExactIconVersionQuery,
  loadSafeIconSource,
  renderRoundedIconWithSharp,
} from './icon-render'

const MEMORY_CACHE_TTL_MS = 60 * 60 * 1000
// 覆盖多副本标签轮询周期（SYNC_INTERVAL_MS = 3000ms），合并并发直连请求并在同步窗口内复用最新配置
const FRESH_SITE_INFO_TTL_MS = 5_000
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

// 站点同一时刻只有一份生效的 (icon, radius) 组合：单槽内存缓存 + 并发合并，占用固定约 3KB，无内存增长风险
let cachedEntry: { key: string, bytes: Uint8Array, expiresAt: number } | null = null
let inflightRender: { key: string, promise: Promise<Uint8Array | null> } | null = null
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

async function renderRoundedIcon(decoded: DecodedIconInput, radiusPercent: number): Promise<Uint8Array | null> {
  try {
    const sharpResult = await renderRoundedIconWithSharp(decoded, radiusPercent)
    if (sharpResult)
      return sharpResult
  }
  catch {
    return null
  }

  // 极端环境下 sharp 不可用时，仅对 Satori 原生支持的格式启用 ImageResponse，避免对 WebP/AVIF 静默生成空白透明图
  if (decoded.kind !== 'encoded' || !IMAGE_RESPONSE_SAFE_MIMES.has(decoded.mime))
    return null

  try {
    const rx = Math.round(ICON_SIZE * radiusPercent) / 100
    const dataUrl = `data:${decoded.mime};base64,${decoded.bytes.toString('base64')}`
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
  catch {
    return null
  }
}

async function getOrRenderIconBytes(icon: string, radius: number, baseUrl?: string, allowCacheWrite = true): Promise<Uint8Array | null> {
  const key = `${icon}|${radius}`
  const now = Date.now()
  if (cachedEntry && cachedEntry.key === key && cachedEntry.expiresAt > now)
    return cachedEntry.bytes

  let currentInflight = inflightRender
  if (!currentInflight || currentInflight.key !== key) {
    const promise = (async () => {
      const loaded = await loadSafeIconSource(icon, baseUrl)
      if (!loaded)
        return null
      return renderRoundedIcon(loaded.decoded, radius)
    })().finally(() => {
      if (inflightRender?.promise === promise)
        inflightRender = null
    })
    currentInflight = { key, promise }
    inflightRender = currentInflight
  }

  const pngBytes = await currentInflight.promise
  // 仅当结果对应当前生效版本且期间未被更新的配置 key 取代时才写回单槽缓存，防止旧请求覆盖新配置缓存
  if (allowCacheWrite && pngBytes && (!inflightRender || inflightRender.key === key))
    cachedEntry = { key, bytes: pngBytes, expiresAt: Date.now() + MEMORY_CACHE_TTL_MS }
  return pngBytes
}

export async function GET(request: Request) {
  await connection()
  const searchParams = new URL(request.url).searchParams
  let siteInfo = await getCachedSiteInfoOrFallback()
  let icon = siteInfo.metadata?.icon?.trim() ?? ''
  let radius = normalizeSiteIconRadius(siteInfo.metadata?.iconRadius)

  // 多副本部署下，管理员刚在副本 A 保存新图标/圆角后，浏览器携带新 ?r=&v= 请求可能落到尚未轮询到新标签的副本 B：
  // 检测到指纹不匹配时，通过 5s 合并缓存直连后端确认一次最新配置，杜绝并发穿透、旧图标闪烁与单槽缓存乒乓覆盖
  const hasVersionParams = searchParams.has('r') || searchParams.has('v')
  if (hasVersionParams && (!icon || !isExactIconVersionQuery(searchParams, radius, icon))) {
    const fresh = await getFreshSiteInfoCoalesced()
    if (fresh) {
      siteInfo = fresh
      icon = fresh.metadata?.icon?.trim() ?? ''
      radius = normalizeSiteIconRadius(fresh.metadata?.iconRadius)
    }
  }

  // 严格只从服务端站点配置读取源图与圆角，不接受查询参数传入外部 URL（杜绝 SSRF 与缓存膨胀）
  if (!icon)
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

  const versionMatch = isExactIconVersionQuery(searchParams, radius, icon)
  const pngBytes = await getOrRenderIconBytes(icon, radius, siteInfo.baseUrl, versionMatch || !hasVersionParams)
  if (!pngBytes)
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

  return new Response(Buffer.from(pngBytes), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      // 仅当查询参数严格为当前生效的 r 与 v 指纹时下发一年 immutable；不匹配或附带多余参数时一律 no-store 防投毒
      'Cache-Control': versionMatch ? IMMUTABLE_CACHE_CONTROL : 'no-store',
    },
  })
}
