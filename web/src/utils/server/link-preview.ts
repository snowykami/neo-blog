import type { IncomingMessage } from 'node:http'
import type { LookupFunction } from 'node:net'
import type { Readable } from 'node:stream'
import type { LinkPreview } from '@/models/link-preview'
import { Buffer } from 'node:buffer'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import zlib from 'node:zlib'
import * as cheerio from 'cheerio'

/**
 * 外链预览抓取（服务端）：取网页的标题、描述、封面与图标
 * - SSRF 防护：只允许 http(s)，解析 DNS 时拦截私网等地址，每一跳重定向都重新校验
 * - 只读到 </head>：元信息都在 head 里，流式渲染的页面正文可能很久才结束
 * - 结果按「读者首选语言 + 地址」缓存在进程内（上游数据，不需要跨实例同步），失败结果只缓存一小段时间
 */

// 抓取限制：最多跟随的重定向次数、整体超时（含读取）、最大读取字节数（解压后）
const MAX_REDIRECTS = 5
const FETCH_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 1024 * 1024
// 判断非网页资源是不是图片只需要文件头
const SNIFF_BYTES = 64

// 如实标明是爬虫：B 站、微博等站点会给带 Bot 标识的请求返回带元信息的服务端渲染页面
const USER_AGENT = 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)'

// 缓存：成功结果保留较久；失败多为对方限流、超时等临时问题，只缓存一分钟避免反复请求
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000
const FAILURE_TTL_MS = 60 * 1000
const CACHE_LIMIT = 500

// 禁止访问的地址段：私网、回环、链路本地、唯一本地、组播、保留段、云厂商元数据等
const blockList = new net.BlockList()
for (const [prefix, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // 运营商级 NAT（含阿里云元数据 100.100.100.200）
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // 链路本地（含 169.254.169.254 元数据）
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  // 198.18.0.0/15（基准测试段）不禁止：Clash/Surge 等 fake-ip 代理会把所有域名解析到该段
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockList.addSubnet(prefix, bits, 'ipv4')
}
for (const [prefix, bits] of [
  ['::', 128], // 未指定地址
  ['::1', 128], // 回环
  // 不要添加 ::ffff:0:0/96：BlockList 会把 IPv4 地址按映射形式匹配 IPv6 规则，该规则会拦截所有 IPv4；
  // 反过来 ::ffff:a.b.c.d 也会按上面的 IPv4 规则校验，无需单独禁止
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48],
  ['100::', 64], // 丢弃前缀
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // 文档地址
  ['2002::', 16], // 6to4，可内嵌任意 IPv4
  ['fc00::', 7], // 唯一本地（含 fd00:ec2::254 元数据）
  ['fe80::', 10], // 链路本地
  ['fec0::', 10], // 站点本地（已废弃）
  ['ff00::', 8], // 组播
] as const) {
  blockList.addSubnet(prefix, bits, 'ipv6')
}

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address)
  if (family === 4)
    return blockList.check(address, 'ipv4')
  if (family === 6)
    return blockList.check(address, 'ipv6')
  // 非法地址一律拒绝
  return true
}

export class BlockedAddressError extends Error {}

// 自定义 DNS 解析：在建立连接时校验解析结果，避免 DNS rebinding（校验与连接使用同一次解析结果）
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err)
      return callback(err, '', 0)
    const list = addresses as dns.LookupAddress[]
    if (list.length === 0 || list.some(item => isBlockedAddress(item.address)))
      return callback(new BlockedAddressError(`Blocked address for ${hostname}`), '', 0)
    if (options.all)
      return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

export function validateTargetUrl(raw: string): URL {
  const urlObj = new URL(raw)
  if (!['http:', 'https:'].includes(urlObj.protocol))
    throw new BlockedAddressError('Invalid URL protocol')
  if (urlObj.username || urlObj.password)
    throw new BlockedAddressError('Credentials in URL are not allowed')
  // IP 字面量不会经过 lookup，需要单独校验（IPv6 的 hostname 带方括号）
  const host = urlObj.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host) && isBlockedAddress(host))
    throw new BlockedAddressError('Blocked address')
  if (host === 'localhost' || host.endsWith('.localhost'))
    throw new BlockedAddressError('Blocked address')
  return urlObj
}

/**
 * 已知站点的抓取地址改写：网易云音乐网页版用 #/ 路由，服务端只能拿到首页，
 * 去掉 #/ 后是同一页面的服务端渲染版本（带歌曲 / 歌单的标题与封面）
 */
export function resolveFetchUrl(urlObj: URL): URL {
  if (urlObj.hostname === 'music.163.com' && urlObj.hash.startsWith('#/')) {
    const rewritten = new URL(urlObj.hash.slice(1), urlObj.origin)
    // #//other.host 会被解析成其他站点，只接受同源结果
    if (rewritten.origin === urlObj.origin)
      return rewritten
  }
  return urlObj
}

/**
 * 只取读者的首选语言发给对方站点（GitHub、YouTube 等会按 Accept-Language 返回不同语言的标题），
 * 规范成固定格式，避免同一语言因写法不同产生多份缓存
 */
export function normalizeAcceptLanguage(header?: string | null): string {
  const first = header?.split(',')[0]?.split(';')[0]?.trim() ?? ''
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(first))
    return 'en'
  const tags = [...new Set([first, first.split('-')[0], 'en'])]
  return tags.map((tag, index) => (index === 0 ? tag : `${tag};q=${(1 - index / 10).toFixed(1)}`)).join(',')
}

// 单次请求，不自动跟随重定向
function requestOnce(urlObj: URL, acceptLanguage: string, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = urlObj.protocol === 'https:' ? https : http
    const req = client.request(urlObj, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': acceptLanguage,
        'Accept-Encoding': 'gzip, deflate, br',
      },
      lookup: safeLookup,
      signal,
    }, resolve)
    req.on('error', reject)
    req.end()
  })
}

/**
 * 按 Content-Encoding 解压后读取，读到 </head> 或 limit 字节即停止并断开连接。
 * 部分站点（如 B 站）不管请求头都返回 gzip，不解压会得到乱码；截断时按已收到的内容尽量解压
 */
export function readHead(source: Readable, contentEncoding: string, limit = MAX_RESPONSE_BYTES): Promise<Buffer> {
  const encoding = contentEncoding.trim().toLowerCase()
  const stream: Readable = encoding === 'gzip' || encoding === 'x-gzip'
    ? source.pipe(zlib.createGunzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH }))
    : encoding === 'deflate'
      ? source.pipe(zlib.createInflate({ finishFlush: zlib.constants.Z_SYNC_FLUSH }))
      : encoding === 'br'
        ? source.pipe(zlib.createBrotliDecompress({ finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH }))
        : source

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    // 上一块的末尾，避免 </head> 被拆在两块之间
    let tail = ''
    const finish = () => {
      resolve(Buffer.concat(chunks).subarray(0, limit))
      source.destroy()
      stream.destroy()
    }
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      size += chunk.length
      // 按 latin1 逐字节查找，不受页面编码影响
      const text = tail + chunk.toString('latin1')
      tail = text.slice(-16)
      if (size >= limit || /<\/head\s*>/i.test(text))
        finish()
    })
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
    source.on('error', reject)
  })
}

function isSupportedCharset(label: string): boolean {
  try {
    return new TextDecoder(label).encoding !== ''
  }
  catch {
    return false
  }
}

/**
 * 识别网页编码，优先级同浏览器：BOM → Content-Type 的 charset → <meta charset> / http-equiv，都没有时按 UTF-8。
 * 国内不少老站点是 GBK / GB2312，只按 UTF-8 解码会得到乱码标题
 */
export function detectCharset(buf: Buffer, contentType: string): string {
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF)
    return 'utf-8'
  if (buf[0] === 0xFE && buf[1] === 0xFF)
    return 'utf-16be'
  if (buf[0] === 0xFF && buf[1] === 0xFE)
    return 'utf-16le'
  const fromHeader = /charset\s*=\s*["']?([\w:.-]+)/i.exec(contentType)?.[1]
  if (fromHeader && isSupportedCharset(fromHeader))
    return fromHeader.toLowerCase()
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w:.-]+)/i.exec(buf.toString('latin1'))?.[1]?.toLowerCase()
  // 能用 latin1 读到 meta 说明内容与 ASCII 兼容，声明为 UTF-16 也按 UTF-8 处理（与浏览器一致）
  if (fromMeta && isSupportedCharset(fromMeta))
    return fromMeta.startsWith('utf-16') ? 'utf-8' : fromMeta
  return 'utf-8'
}

export function decodeHtml(buf: Buffer, contentType: string): string {
  return new TextDecoder(detectCharset(buf, contentType)).decode(buf)
}

// 常见图片的文件头：对象存储经常把图片标成 application/octet-stream
export function isImageBytes(buf: Buffer): boolean {
  const ascii = buf.subarray(0, 16).toString('latin1')
  return (buf[0] === 0x89 && ascii.startsWith('PNG', 1))
    || (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF)
    || ascii.startsWith('GIF8')
    || (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP')
    || (ascii.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii.slice(8, 12)))
}

// 仅允许返回 http(s) 资源地址
function toHttpUrl(value: string | undefined, base: URL): string | undefined {
  if (!value)
    return undefined
  try {
    const resolved = new URL(value, base)
    return ['http:', 'https:'].includes(resolved.protocol) ? resolved.href : undefined
  }
  catch {
    return undefined
  }
}

function clean(value: string | undefined, maxLength: number): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

/** 从网页 HTML 中提取预览信息；finalUrl 为重定向后的地址，用于补全相对路径 */
export function extractMetadata(html: string, finalUrl: URL, requestedUrl: string): LinkPreview {
  const $ = cheerio.load(html)
  const meta = (...names: string[]) => {
    for (const name of names) {
      const value = $(`meta[property="${name}"], meta[name="${name}"]`).first().attr('content')?.trim()
      if (value)
        return value
    }
    return undefined
  }

  // 只取第一个 <title>：正文里的 SVG 也可能带 <title>
  const title = meta('og:title', 'twitter:title') || $('title').first().text()
  const description = meta('og:description', 'twitter:description', 'description')
  const image = meta('og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src')
    || $('link[rel="image_src"]').attr('href')
  // rel~="icon" 同时匹配 icon 与 shortcut icon
  const favicon = $('link[rel~="icon"]').first().attr('href') || $('link[rel="apple-touch-icon"]').first().attr('href')

  return {
    title: clean(title, 100),
    description: clean(description, 200),
    image: toHttpUrl(image, finalUrl),
    favicon: toHttpUrl(favicon, finalUrl) || `${finalUrl.origin}/favicon.ico`,
    url: requestedUrl,
    siteName: clean(meta('og:site_name'), 100) || finalUrl.hostname,
  }
}

/** 非网页资源：图片直接作为封面（文件名多为哈希，不作标题），其他文件（PDF、压缩包等）以文件名为标题 */
export function fileMetadata(finalUrl: URL, requestedUrl: string, isImage: boolean): LinkPreview {
  let fileName = isImage ? '' : finalUrl.pathname.split('/').filter(Boolean).pop() ?? ''
  try {
    fileName = decodeURIComponent(fileName)
  }
  catch {}
  return {
    title: clean(fileName, 100),
    description: '',
    image: isImage ? finalUrl.href : undefined,
    favicon: `${finalUrl.origin}/favicon.ico`,
    url: requestedUrl,
    siteName: finalUrl.hostname,
  }
}

async function fetchLinkPreview(url: string, acceptLanguage: string): Promise<LinkPreview> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    let current = resolveFetchUrl(validateTargetUrl(url))
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await requestOnce(current, acceptLanguage, controller.signal)
      const status = res.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.resume()
        const location = res.headers.location
        if (!location)
          throw new Error(`HTTP ${status} without location`)
        // 每一跳都重新校验协议与地址
        current = validateTargetUrl(new URL(location, current).href)
        continue
      }
      if (status < 200 || status >= 300) {
        res.resume()
        throw new Error(`HTTP ${status}`)
      }
      const contentType = String(res.headers['content-type'] || '')
      const contentEncoding = String(res.headers['content-encoding'] || '')
      // SVG 的类型带 xml，也按图片处理
      if (/^image\//i.test(contentType) || (contentType && !/html|xml/i.test(contentType))) {
        const head = await readHead(res, contentEncoding, SNIFF_BYTES)
        return fileMetadata(current, url, /^image\//i.test(contentType) || isImageBytes(head))
      }
      const body = await readHead(res, contentEncoding)
      return extractMetadata(decodeHtml(body, contentType), current, url)
    }
    throw new Error('Too many redirects')
  }
  finally {
    clearTimeout(timer)
  }
}

interface CacheEntry {
  task: Promise<LinkPreview>
  expires: number
}

const cache = new Map<string, CacheEntry>()

/**
 * 获取链接预览：同一地址同时只抓取一次，结果按语言缓存；
 * 地址不允许访问时抛出 BlockedAddressError，其余失败抛出普通错误
 */
export function getLinkPreview(url: string, acceptLanguageHeader?: string | null): Promise<LinkPreview> {
  const acceptLanguage = normalizeAcceptLanguage(acceptLanguageHeader)
  const key = `${acceptLanguage} ${url}`
  const now = Date.now()
  const hit = cache.get(key)
  cache.delete(key)
  if (hit && hit.expires > now) {
    // 重新插入到末尾，淘汰时优先删除最久未用的
    cache.set(key, hit)
    return hit.task
  }

  const entry: CacheEntry = { task: fetchLinkPreview(url, acceptLanguage), expires: Number.POSITIVE_INFINITY }
  entry.task.then(
    () => {
      entry.expires = Date.now() + SUCCESS_TTL_MS
    },
    (error) => {
      entry.expires = Date.now() + (error instanceof BlockedAddressError ? SUCCESS_TTL_MS : FAILURE_TTL_MS)
    },
  )
  cache.set(key, entry)
  if (cache.size > CACHE_LIMIT)
    cache.delete(cache.keys().next().value!)
  return entry.task
}
