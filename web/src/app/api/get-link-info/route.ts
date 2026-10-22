import type { NextRequest } from 'next/server'
import type { IncomingMessage } from 'node:http'
import type { LookupFunction } from 'node:net'
import { Buffer } from 'node:buffer'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import * as cheerio from 'cheerio'
import { NextResponse } from 'next/server'
import { getLoginUserServer } from '@/api/user.server'

export interface LinkPreview {
  title: string
  description: string
  image?: string
  favicon?: string
  url: string
  siteName?: string
}

// 链接预览抓取限制：最多跟随的重定向次数、整体超时、最大读取字节数
const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 8000
const MAX_RESPONSE_BYTES = 1024 * 1024

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

function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address)
  if (family === 4)
    return blockList.check(address, 'ipv4')
  if (family === 6)
    return blockList.check(address, 'ipv6')
  // 非法地址一律拒绝
  return true
}

class BlockedAddressError extends Error {}

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

function validateTargetUrl(raw: string): URL {
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

interface FetchResult {
  url: URL
  body: string
}

// 单次请求，不自动跟随重定向；返回响应或重定向目标
function requestOnce(urlObj: URL, signal: AbortSignal): Promise<{ res: IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const client = urlObj.protocol === 'https:' ? https : http
    const req = client.request(urlObj, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      lookup: safeLookup,
      signal,
    }, res => resolve({ res }))
    req.on('error', reject)
    req.end()
  })
}

function readBody(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    res.on('data', (chunk: Buffer) => {
      size += chunk.length
      chunks.push(chunk)
      // 只需要 <head> 中的元信息，超出上限直接截断
      if (size >= MAX_RESPONSE_BYTES) {
        res.destroy()
        resolve(Buffer.concat(chunks).subarray(0, MAX_RESPONSE_BYTES).toString('utf-8'))
      }
    })
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    res.on('error', reject)
  })
}

async function safeFetchHtml(raw: string): Promise<FetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    let current = validateTargetUrl(raw)
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const { res } = await requestOnce(current, controller.signal)
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
      if (contentType && !/html|xml/i.test(contentType)) {
        res.destroy()
        throw new Error(`Unsupported content type: ${contentType}`)
      }
      return { url: current, body: await readBody(res) }
    }
    throw new Error('Too many redirects')
  }
  finally {
    clearTimeout(timer)
  }
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

export async function GET(request: NextRequest) {
  // 仅登录用户可用，避免被匿名滥用为代理
  const user = await getLoginUserServer().then(res => res.data).catch(() => null)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  }

  try {
    validateTargetUrl(url)
  }
  catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  try {
    const { url: finalUrl, body: html } = await safeFetchHtml(url)
    const $ = cheerio.load(html)

    // 提取 meta 信息
    const getMetaContent = (property: string) => {
      return (
        $(`meta[property="${property}"]`).attr('content')
        || $(`meta[name="${property}"]`).attr('content')
        || $(`meta[property="twitter:${property.replace('og:', '')}"]`).attr('content')
      )
    }

    const title
      = getMetaContent('og:title')
        || $('title').text()
        || getMetaContent('twitter:title')
        || 'No title'

    const description
      = getMetaContent('og:description')
        || $('meta[name="description"]').attr('content')
        || getMetaContent('twitter:description')
        || ''

    const image
      = getMetaContent('og:image')
        || getMetaContent('twitter:image')
        || $('link[rel="image_src"]').attr('href')

    const siteName = getMetaContent('og:site_name') || finalUrl.hostname

    // 获取 favicon
    const favicon
      = $('link[rel="icon"]').attr('href')
        || $('link[rel="shortcut icon"]').attr('href')
        || $('link[rel="apple-touch-icon"]').attr('href')

    const preview: LinkPreview = {
      title: title.trim().substring(0, 100),
      description: description.trim().substring(0, 200),
      image: toHttpUrl(image, finalUrl),
      favicon: toHttpUrl(favicon, finalUrl) || `${finalUrl.origin}/favicon.ico`,
      url,
      siteName,
    }

    return NextResponse.json(preview, {
      // 结果与用户无关，但接口需要登录，仅允许浏览器私有缓存
      headers: { 'Cache-Control': 'private, max-age=3600' },
    })
  }
  catch (error) {
    if (error instanceof BlockedAddressError)
      return NextResponse.json({ error: 'Blocked URL' }, { status: 400 })
    console.error('Link preview error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to fetch link preview' }, { status: 502 })
  }
}
