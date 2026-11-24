import { Buffer } from 'node:buffer'
import dns from 'node:dns/promises'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { BACKEND_URL } from '@/api/client'
import { siteIconVersionHash } from '@/utils/common/siteinfo'

export const ICON_SIZE = 64
export const FETCH_TIMEOUT_MS = 8_000
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024
export const MAX_INPUT_PIXELS = 4096 * 4096
const MAX_REDIRECT_HOPS = 3

// 仅放行公开文件访问路由 /api/v1/file/f/<id>[/<filename>]，阻断任意内部 /api/ 探测与路径穿越
const INTERNAL_FILE_PATH_RE = /^\/api\/v1\/file\/f\/\d+(?:\/[^?#]*)?$/

// Satori (next/og ImageResponse) 仅原生支持这四类格式；WebP / AVIF / 裸像素传入会静默输出全透明图或抛错
export const IMAGE_RESPONSE_SAFE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
])

interface SharpRawOptions {
  raw?: {
    width: number
    height: number
    channels: 4
  }
  limitInputPixels?: number
}

interface SharpInstance {
  rotate: () => SharpInstance
  resize: (width: number, height: number, options?: { fit?: 'cover' }) => SharpInstance
  ensureAlpha: () => SharpInstance
  composite: (overlays: Array<{ input: Buffer, blend: 'dest-in' }>) => SharpInstance
  png: (options?: { compressionLevel?: number }) => SharpInstance
  toBuffer: () => Promise<Buffer>
}
type SharpFactory = (input: Buffer, options?: SharpRawOptions) => SharpInstance

let cachedSharp: SharpFactory | false | undefined

/**
 * 复用 Next.js 自身依赖树内的 sharp（standalone 镜像中已随 next-server 一并打包，无需额外装包）：
 * 注意不能使用 createRequire(import.meta.url).resolve('next/package.json')，否则 Turbopack 生产构建会把
 * resolve('next/package.json') 静态折叠为内部数字模块 ID 导致运行时报 ERR_INVALID_ARG_VALUE；
 * 这里以运行期 process.cwd() 下的 package.json 为起点动态解析，兼容 dev / Docker standalone / 本地 standalone
 */
export function getSharp(): SharpFactory | null {
  if (cachedSharp !== undefined)
    return cachedSharp || null
  const anchorCandidates = [
    path.join(process.cwd(), 'package.json'),
    path.join(process.cwd(), '..', '..', 'package.json'),
  ]
  for (const anchor of anchorCandidates) {
    try {
      const rootRequire = createRequire(/* turbopackIgnore: true */ anchor)
      const nextPkgPath = rootRequire.resolve(/* turbopackIgnore: true */ 'next/package.json')
      const nextRequire = createRequire(/* turbopackIgnore: true */ nextPkgPath)
      cachedSharp = nextRequire(/* turbopackIgnore: true */ 'sharp') as SharpFactory
      return cachedSharp
    }
    catch {
      continue
    }
  }
  cachedSharp = false
  return null
}

export type DecodedIconInput
  = | { kind: 'encoded', bytes: Buffer, mime: string }
    | { kind: 'raw', rgba: Buffer, width: number, height: number }

function isSvgBuffer(bytes: Buffer): boolean {
  const head = bytes.subarray(0, Math.min(bytes.length, 4096)).toString('utf8').replace(/^\uFEFF/, '')
  const strippedHead = head
    .replace(/^(?:\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!doctype[^>]*>)*/i, '')
  if (!/^<svg[\s>]/i.test(strippedHead))
    return false
  const fullText = bytes.length <= 4096 ? head : bytes.toString('utf8')
  return !/<script[\s>/]/i.test(fullText)
}

/** 按文件魔数嗅探真实图片类型；即使上游返回 application/octet-stream 也可识别合法图片，同时拦截 HTML 错误页伪装 */
export function sniffImageMime(bytes: Buffer, headerContentType = ''): string | null {
  if (bytes.length < 4)
    return null
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)
    return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47)
    return 'image/png'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    return 'image/gif'
  if (
    bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00)
    return 'image/x-icon'
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii')
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1')
      return 'image/avif'
  }
  if (isSvgBuffer(bytes))
    return 'image/svg+xml'

  const normalized = headerContentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/gif' || normalized === 'image/webp' || normalized === 'image/avif')
    return normalized
  return null
}

/**
 * 解析标准 .ico 容器（魔数 00 00 01 00）：
 * Next 内置的预编译 sharp (libvips) 不支持直接解码 .ico 容器，这里按评分从高到低依次尝试候选帧，
 * 若帧内是 PNG 则直接拆出交由 sharp 处理，若为 BITMAPINFOHEADER DIB（支持 1/4/8/24/32 位）则还原为顶向下的 RGBA 像素流
 */
export function decodeIcoFrame(bytes: Buffer): DecodedIconInput | null {
  if (bytes.length < 22)
    return null
  const reserved = bytes.readUInt16LE(0)
  const icoType = bytes.readUInt16LE(2)
  const count = bytes.readUInt16LE(4)
  if (reserved !== 0 || icoType !== 1 || count < 1 || count > 64)
    return null
  const dirEnd = 6 + count * 16
  if (bytes.length < dirEnd)
    return null

  const candidates: Array<{ score: number, slice: Buffer }> = []

  for (let i = 0; i < count; i++) {
    const entryOffset = 6 + i * 16
    const w = bytes[entryOffset]! || 256
    const h = bytes[entryOffset + 1]! || 256
    const bitCount = bytes.readUInt16LE(entryOffset + 6)
    const size = bytes.readUInt32LE(entryOffset + 8)
    const offset = bytes.readUInt32LE(entryOffset + 12)
    if (size < 8 || offset < dirEnd || offset + size > bytes.length)
      continue

    const slice = bytes.subarray(offset, offset + size)
    const isPng = slice[0] === 0x89 && slice[1] === 0x50 && slice[2] === 0x4E && slice[3] === 0x47
    const edge = Math.min(w, h)
    // 优先选 >= 64px 中最贴近 64px 的帧（避免无谓解码超大帧），若都小于 64px 则选尺寸最大的帧；同尺寸优先内嵌 PNG 与高色深
    const sizeScore = edge >= ICON_SIZE ? 10_000 - (edge - ICON_SIZE) : edge * 100
    const score = sizeScore + (isPng ? 50 : 0) + Math.min(bitCount, 32)
    candidates.push({ score, slice })
  }

  candidates.sort((a, b) => b.score - a.score)

  for (const { slice } of candidates) {
    if (slice[0] === 0x89 && slice[1] === 0x50 && slice[2] === 0x4E && slice[3] === 0x47)
      return { kind: 'encoded', bytes: Buffer.from(slice), mime: 'image/png' }
    const dib = decodeDibToRgba(slice)
    if (dib)
      return dib
  }

  return null
}

function decodeDibToRgba(frame: Buffer): DecodedIconInput | null {
  if (frame.length < 40)
    return null
  const headerSize = frame.readUInt32LE(0)
  if (headerSize < 40 || headerSize > frame.length)
    return null

  const width = frame.readInt32LE(4)
  const rawHeight = frame.readInt32LE(8)
  const planes = frame.readUInt16LE(12)
  const bpp = frame.readUInt16LE(14)
  const compression = frame.readUInt32LE(16)
  const clrUsed = frame.readUInt32LE(32)

  const topDown = rawHeight < 0
  const height = Math.abs(rawHeight) / 2
  if (
    width <= 0 || width > 512
    || !Number.isInteger(height) || height <= 0 || height > 512
    || planes > 1
    || compression !== 0
    || (bpp !== 32 && bpp !== 24 && bpp !== 8 && bpp !== 4 && bpp !== 1)
  ) {
    return null
  }

  const paletteEntries = bpp <= 8 ? (clrUsed > 0 ? clrUsed : (1 << bpp)) : 0
  const paletteBytes = paletteEntries * 4
  const xorOffset = headerSize + paletteBytes
  const xorStride = Math.floor((width * bpp + 31) / 32) * 4
  const andStride = Math.floor((width + 31) / 32) * 4
  const andOffset = xorOffset + xorStride * height

  if (xorOffset + xorStride * height > frame.length)
    return null
  const hasAndMask = andOffset + andStride * height <= frame.length

  let hasExplicitAlpha = false
  if (bpp === 32) {
    for (let y = 0; y < height && !hasExplicitAlpha; y++) {
      const rowBase = xorOffset + y * xorStride
      for (let x = 0; x < width; x++) {
        if (frame[rowBase + x * 4 + 3] !== 0) {
          hasExplicitAlpha = true
          break
        }
      }
    }
  }

  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : (height - 1 - y)
    const xorRow = xorOffset + srcY * xorStride
    const andRow = andOffset + srcY * andStride

    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 255

      const maskTransparent = hasAndMask
        ? ((frame[andRow + (x >> 3)]! & (0x80 >> (x & 7))) !== 0)
        : false

      if (bpp === 32) {
        const px = xorRow + x * 4
        b = frame[px]!
        g = frame[px + 1]!
        r = frame[px + 2]!
        a = hasExplicitAlpha ? frame[px + 3]! : (maskTransparent ? 0 : 255)
      }
      else if (bpp === 24) {
        const px = xorRow + x * 3
        b = frame[px]!
        g = frame[px + 1]!
        r = frame[px + 2]!
        a = maskTransparent ? 0 : 255
      }
      else {
        let paletteIdx = 0
        if (bpp === 8)
          paletteIdx = frame[xorRow + x]!
        else if (bpp === 4)
          paletteIdx = (x & 1) === 0 ? (frame[xorRow + (x >> 1)]! >> 4) : (frame[xorRow + (x >> 1)]! & 0x0F)
        else
          paletteIdx = (frame[xorRow + (x >> 3)]! & (0x80 >> (x & 7))) !== 0 ? 1 : 0

        if (paletteIdx >= paletteEntries)
          return null
        const palOffset = headerSize + paletteIdx * 4
        b = frame[palOffset]!
        g = frame[palOffset + 1]!
        r = frame[palOffset + 2]!
        a = maskTransparent ? 0 : 255
      }

      const dst = (y * width + x) * 4
      rgba[dst] = r
      rgba[dst + 1] = g
      rgba[dst + 2] = b
      rgba[dst + 3] = a
    }
  }

  return { kind: 'raw', rgba, width, height }
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(n => Number.parseInt(n, 10))
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255))
    return true
  const [a, b, c] = parts as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127 || a >= 224)
    return true
  if (a === 100 && (b & 0xC0) === 64)
    return true
  if (a === 169 && b === 254)
    return true
  if (a === 172 && b >= 16 && b <= 31)
    return true
  if (a === 192 && b === 0 && (c === 0 || c === 2))
    return true
  if (a === 192 && b === 168)
    return true
  if (a === 198 && (b === 18 || b === 19))
    return true
  if (a === 198 && b === 51 && c === 100)
    return true
  if (a === 203 && b === 0 && c === 113)
    return true
  return false
}

function parseIpv6Groups(rawIp: string): number[] | null {
  const clean = rawIp.split('%')[0]!.toLowerCase()
  let ip = clean
  const lastColon = ip.lastIndexOf(':')
  if (lastColon !== -1 && ip.includes('.')) {
    const v4Part = ip.slice(lastColon + 1)
    if (net.isIPv4(v4Part)) {
      const nums = v4Part.split('.').map(n => Number.parseInt(n, 10))
      const hi = ((nums[0]! << 8) | nums[1]!).toString(16)
      const lo = ((nums[2]! << 8) | nums[3]!).toString(16)
      ip = `${ip.slice(0, lastColon)}:${hi}:${lo}`
    }
  }
  const halves = ip.split('::')
  if (halves.length > 2)
    return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1))
    return null
  const full = [...left, ...Array.from<string>({ length: missing }).fill('0'), ...right]
  if (full.length !== 8)
    return null
  const groups = full.map(part => Number.parseInt(part, 16))
  if (groups.some(g => Number.isNaN(g) || g < 0 || g > 0xFFFF))
    return null
  return groups
}

function groupsToIpv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xFF}.${hi & 0xFF}.${(lo >> 8) & 0xFF}.${lo & 0xFF}`
}

/** 拦截回环、RFC1918 私网、链路本地/云元数据（169.254/16、100.64/10）、IPv6 本地及内嵌私网 IPv4 地址 */
export function isBlockedIpAddress(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, '').split('%')[0]!
  const version = net.isIP(clean)
  if (version === 4)
    return isBlockedIpv4(clean)
  if (version !== 6)
    return true

  const g = parseIpv6Groups(clean)
  if (!g)
    return true
  const g0 = g[0]!
  // :: (未指定) 与 ::1 (回环)
  if (g.slice(0, 7).every(x => x === 0) && (g[7] === 0 || g[7] === 1))
    return true
  // IPv4-mapped (::ffff:w.x.y.z) 与 IPv4-compatible (::w.x.y.z)
  if (g.slice(0, 5).every(x => x === 0) && (g[5] === 0xFFFF || g[5] === 0))
    return isBlockedIpv4(groupsToIpv4(g[6]!, g[7]!))
  // NAT64 (64:ff9b::/96)
  if (g0 === 0x0064 && g[1] === 0xFF9B && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0)
    return isBlockedIpv4(groupsToIpv4(g[6]!, g[7]!))
  // 6to4 (2002::/16)
  if (g0 === 0x2002)
    return isBlockedIpv4(groupsToIpv4(g[1]!, g[2]!))
  // 文档保留段 (2001:db8::/32)、唯一本地 (fc00::/7)、链路本地 (fe80::/10)、组播 (ff00::/8)
  if (
    (g0 === 0x2001 && g[1] === 0x0DB8)
    || (g0 & 0xFE00) === 0xFC00
    || (g0 & 0xFFC0) === 0xFE80
    || (g0 & 0xFF00) === 0xFF00
  ) {
    return true
  }
  return false
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').trim().toLowerCase().replace(/\.$/, '')
  if (!host)
    return true
  if (net.isIP(host))
    return isBlockedIpAddress(host)
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.cluster.local')
    || !host.includes('.')
  ) {
    return true
  }
  return false
}

async function assertSafeExternalUrl(url: URL): Promise<boolean> {
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
    return false
  if (isBlockedHostname(url.hostname))
    return false
  const bareHost = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(bareHost))
    return !isBlockedIpAddress(bareHost)
  try {
    const records = await dns.lookup(bareHost, { all: true, verbatim: true })
    return records.length > 0 && records.every(rec => !isBlockedIpAddress(rec.address))
  }
  catch {
    return false
  }
}

/** 按流分块读取响应体，一旦超过 MAX_SOURCE_BYTES 立即取消流，防止大响应撑爆内存 */
export async function readResponseBytesBounded(res: Response, maxBytes = MAX_SOURCE_BYTES): Promise<Buffer | null> {
  const declaredLength = Number.parseInt(res.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declaredLength) && (declaredLength <= 0 || declaredLength > maxBytes))
    return null
  if (!res.body)
    return null

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      if (value && value.byteLength > 0) {
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel()
          return null
        }
        chunks.push(value)
      }
    }
  }
  catch {
    await reader.cancel().catch(() => undefined)
    return null
  }
  return total > 0 ? Buffer.concat(chunks, total) : null
}

function decodeDataUriIcon(icon: string): { bytes: Buffer, contentType: string } | null {
  const commaIdx = icon.indexOf(',')
  if (commaIdx <= 5)
    return null
  const meta = icon.slice(5, commaIdx)
  if (!meta.toLowerCase().startsWith('image/'))
    return null
  const isBase64 = /;base64$/i.test(meta)
  const contentType = meta.split(';')[0]!.trim().toLowerCase()
  const payload = icon.slice(commaIdx + 1)
  if (payload.length > MAX_SOURCE_BYTES * 2)
    return null
  try {
    let bytes: Buffer
    if (isBase64) {
      bytes = Buffer.from(payload, 'base64')
    }
    else {
      try {
        bytes = Buffer.from(decodeURIComponent(payload), 'utf8')
      }
      catch {
        bytes = Buffer.from(payload, 'utf8')
      }
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_SOURCE_BYTES)
      return null
    return { bytes, contentType }
  }
  catch {
    return null
  }
}

async function readPublicStaticIcon(pathname: string): Promise<Buffer | null> {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  }
  catch {
    return null
  }
  if (decodedPath.includes('\0'))
    return null

  // 兼容 dev / Docker standalone (/app/public) 与本地 standalone (.next/standalone -> ../../public)
  const publicCandidates = [
    path.resolve(process.cwd(), 'public'),
    path.resolve(process.cwd(), '..', '..', 'public'),
  ]
  const normalizedRelInput = `.${decodedPath.startsWith('/') ? decodedPath : `/${decodedPath}`}`

  for (const publicRoot of publicCandidates) {
    const candidate = path.resolve(publicRoot, normalizedRelInput)
    const rel = path.relative(publicRoot, candidate)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
      continue
    try {
      const [realRoot, realCandidate] = await Promise.all([
        fs.realpath(/* turbopackIgnore: true */ publicRoot),
        fs.realpath(/* turbopackIgnore: true */ candidate),
      ])
      const realRel = path.relative(realRoot, realCandidate)
      if (!realRel || realRel.startsWith('..') || path.isAbsolute(realRel))
        continue
      const stat = await fs.stat(/* turbopackIgnore: true */ realCandidate)
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SOURCE_BYTES)
        continue
      return await fs.readFile(/* turbopackIgnore: true */ realCandidate)
    }
    catch {
      continue
    }
  }
  return null
}

async function fetchExternalWithSafeRedirects(initialUrl: string): Promise<{ bytes: Buffer, contentType: string } | null> {
  let currentUrl: URL
  try {
    currentUrl = new URL(initialUrl)
  }
  catch {
    return null
  }

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    if (!(await assertSafeExternalUrl(currentUrl)))
      return null
    const res = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      await res.body?.cancel().catch(() => undefined)
      if (!location || hop === MAX_REDIRECT_HOPS)
        return null
      try {
        currentUrl = new URL(location, currentUrl)
      }
      catch {
        return null
      }
      continue
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined)
      return null
    }
    const bytes = await readResponseBytesBounded(res)
    if (!bytes)
      return null
    return { bytes, contentType: res.headers.get('content-type') ?? '' }
  }
  return null
}

/**
 * 安全加载站点图标原始字节：
 * - `data:image/...`：直接内存解码
 * - `/api/v1/file/f/<id>`：直连内部后端并附带 `?proxy=1`（跳过 S3 302 跳转并带出数据库权威 MIME），拒绝其余 `/api/` 路径
 * - `/xxx` 站内静态文件：优先从本地 `public/` 安全读取，未命中且配置了公网 `baseUrl` 时再按外链安全规则回退抓取
 * - `//...` 或 `http(s)://...` 外链：每跳执行 DNS 私网/元数据地址拦截 + 流式体积上限保护
 */
export async function loadSafeIconSource(icon: string, baseUrl?: string): Promise<{ decoded: DecodedIconInput } | null> {
  const trimmed = icon.trim()
  if (!trimmed)
    return null

  let raw: { bytes: Buffer, contentType: string } | null = null

  if (/^data:/i.test(trimmed)) {
    raw = decodeDataUriIcon(trimmed)
  }
  else if (trimmed.startsWith('//')) {
    raw = await fetchExternalWithSafeRedirects(`https:${trimmed}`).catch(() => null)
  }
  else if (/^https?:\/\//i.test(trimmed)) {
    raw = await fetchExternalWithSafeRedirects(trimmed).catch(() => null)
  }
  else if (trimmed.startsWith('/api/')) {
    const pathname = trimmed.split(/[?#]/)[0] ?? ''
    if (!INTERNAL_FILE_PATH_RE.test(pathname))
      return null
    const res = await fetch(`${BACKEND_URL}${pathname}?proxy=1`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch(() => null)
    if (!res || !res.ok) {
      await res?.body?.cancel().catch(() => undefined)
      return null
    }
    const bytes = await readResponseBytesBounded(res)
    if (bytes)
      raw = { bytes, contentType: res.headers.get('content-type') ?? '' }
  }
  else {
    const pathname = (trimmed.startsWith('/') ? trimmed : `/${trimmed}`).split(/[?#]/)[0] ?? ''
    const localBytes = await readPublicStaticIcon(pathname)
    if (localBytes) {
      raw = { bytes: localBytes, contentType: '' }
    }
    else if (baseUrl && /^https?:\/\//i.test(baseUrl.trim())) {
      try {
        const externalUrl = new URL(pathname, baseUrl.trim()).toString()
        raw = await fetchExternalWithSafeRedirects(externalUrl).catch(() => null)
      }
      catch {
        raw = null
      }
    }
  }

  if (!raw)
    return null

  const mime = sniffImageMime(raw.bytes, raw.contentType)
  if (!mime)
    return null

  if (mime === 'image/x-icon') {
    const icoDecoded = decodeIcoFrame(raw.bytes)
    return icoDecoded ? { decoded: icoDecoded } : null
  }

  return { decoded: { kind: 'encoded', bytes: raw.bytes, mime } }
}

/** 使用 sharp 渲染 64×64 圆角 PNG（支持 PNG/JPEG/WebP/AVIF/GIF/SVG 及 .ico 解包后的 RGBA 帧） */
export async function renderRoundedIconWithSharp(decoded: DecodedIconInput, radiusPercent: number): Promise<Uint8Array | null> {
  const sharp = getSharp()
  if (!sharp)
    return null

  const rx = Math.round(ICON_SIZE * radiusPercent) / 100
  const maskSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}"><rect width="${ICON_SIZE}" height="${ICON_SIZE}" rx="${rx}" ry="${rx}" fill="#fff"/></svg>`,
  )

  const pipeline = decoded.kind === 'raw'
    ? sharp(decoded.rgba, {
        raw: { width: decoded.width, height: decoded.height, channels: 4 },
        limitInputPixels: MAX_INPUT_PIXELS,
      })
    : sharp(decoded.bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate()

  const out = await pipeline
    .resize(ICON_SIZE, ICON_SIZE, { fit: 'cover' })
    .ensureAlpha()
    .composite([{ input: maskSvg, blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer()

  return new Uint8Array(out)
}

/** 仅当查询参数严格只包含 r 与 v 且与当前生效配置指纹完全一致时，才允许下发一年 immutable 强缓存 */
export function isExactIconVersionQuery(searchParams: URLSearchParams, radius: number, icon: string): boolean {
  for (const key of searchParams.keys()) {
    if (key !== 'r' && key !== 'v')
      return false
  }
  return searchParams.get('r') === String(radius) && searchParams.get('v') === siteIconVersionHash(icon)
}
