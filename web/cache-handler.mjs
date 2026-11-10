// @ts-check
/*
 * Next.js 的增量缓存处理器（next.config.ts 的 cacheHandler）：ISR 页面与 unstable_cache 的取数结果都存在这里。
 *
 * 1. 失效：后端数据变化时换掉对应标签的版本号（internal/repo/cache_tag.go），本进程每 3 秒读一次（GET /misc/cache-tags）。
 *    写入条目时在它的标签里记下「当时已知的版本号」（形如 neo-ver:posts:<版本>），读取时与最新的版本号比较，不同就当作没有缓存，
 *    下次访问重新取数、重新生成。按版本号而不是按时间比较：几个副本得知修改有先后，还没得知的副本即使在别的副本之后
 *    写入了旧内容，它记下的也是旧版本号，其他副本一读就知道已经过期；也不受各台机器时钟误差的影响。
 *    用轮询而不是后端主动通知：后端不用知道前端地址、不用共享密钥，多个前端副本各自轮询，没有 Redis 时也都能失效。
 *    标签只到数据种类（见 src/lib/cache-tags.ts），接口不透露具体是哪篇文章。
 * 2. 存储：配置了 REDIS_URL（与后端、运行时指标共用，键前缀 REDIS_KEY_PREFIX）时条目存进 Redis，多个前端副本共用，
 *    一个副本生成过的页面其他副本直接用。没配置时沿用 Next 自带的文件系统缓存（内存 LRU + .next 目录），只在本进程内有效；
 *    上次运行时留下的条目同样按版本号判断，期间后端改过的不会再用。
 * 3. 代码里调用 revalidateTag / revalidatePath（目前没有）时按时间失效，配置了 Redis 时写进 Redis 让其他副本在下一次轮询时看到。
 *
 * 构建（next build）时也会加载这个文件：构建期不轮询、不连 Redis，行为与 Next 自带的缓存相同。
 * 这个文件不经过打包，由 Next 在运行时直接 import，standalone 输出会自动带上它和 ioredis。
 * 依赖 Next 内部的 FileSystemCache（next/dist/server/lib/incremental-cache/file-system-cache.js），升级 Next 时要复查。
 */
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { gunzipSync, gzipSync } from 'node:zlib'
import { Redis } from 'ioredis'

const require = createRequire(import.meta.url)
/** @type {any} */
const FileSystemCache = require('next/dist/server/lib/incremental-cache/file-system-cache.js').default

const SYNC_INTERVAL_MS = 3000
// 首次读取版本号的最长等待：在此之前的缓存读取先等它，避免刚启动时把已经过期的条目当成有效
const FIRST_SYNC_TIMEOUT_MS = 1500
const REQUEST_TIMEOUT_MS = 2000
// 读取到写入之间记下的版本号最多保留多久：一次渲染不会比这更久，过期的说明这次读取之后没有重新生成
const PENDING_TTL_MS = 30_000
// Redis 中条目的最长保存时间：长时间没人访问的页面过期后重新生成
const MAX_ENTRY_TTL_SECONDS = 24 * 3600
const ERROR_LOG_INTERVAL_MS = 60_000
const DEFAULT_REDIS_PREFIX = 'neo-blog:'
const CACHE_TAGS_HEADER = 'x-next-cache-tags'
// 依赖后端数据的标签，与 src/lib/cache-tags.ts 的 CacheTag、后端 repo.CacheTags 一致
const BACKEND_TAGS = ['posts', 'pages', 'users', 'site']
// 记录版本号的标签前缀：混在条目自己的标签里，随条目一起保存（页面的标签不会发给浏览器）
const VERSION_TAG_PREFIX = 'neo-ver:'

// 与 src/api/client.ts 的 BACKEND_URL 一致
const BACKEND_URL = (process.env.BACKEND_URL
  || (process.env.NODE_ENV === 'production' ? 'http://neo-blog-backend:8888' : 'http://localhost:8888')).replace(/\/+$/, '')

/**
 * 每个请求都会 new 一个处理器，跨请求的状态放在 globalThis 上
 * @typedef {{
 *   started: boolean,
 *   ready: Promise<void>,
 *   redis: Redis | null,
 *   prefix: string,
 *   buildId: string,
 *   versions: Record<string, string> | null,
 *   pending: Map<string, { versions: Record<string, string> | null, at: number }>,
 *   expiredAt: Map<string, number>,
 *   lastErrorAt: number,
 * }} HandlerState
 */
const STATE_KEY = Symbol.for('neo-blog.cache-handler')

/** @returns {HandlerState} 本进程共用的状态 */
function state() {
  const holder = /** @type {Record<symbol, HandlerState | undefined>} */ (/** @type {unknown} */ (globalThis))
  holder[STATE_KEY] ??= {
    started: false,
    ready: Promise.resolve(),
    redis: null,
    prefix: process.env.REDIS_KEY_PREFIX || DEFAULT_REDIS_PREFIX,
    buildId: '',
    // 后端各标签的最新版本号；还没取到时为 null，此时不按版本号判断
    versions: null,
    // 读取时记下的版本号，写入同一个键时用它（见 set）
    pending: new Map(),
    // revalidateTag 的失效时间
    expiredAt: new Map(),
    lastErrorAt: 0,
  }
  return holder[STATE_KEY]
}

/** @param {unknown} err */
function logError(err) {
  const s = state()
  if (Date.now() - s.lastErrorAt < ERROR_LOG_INTERVAL_MS)
    return
  s.lastErrorAt = Date.now()
  console.warn('[cache-handler]', err instanceof Error ? err.message : err)
}

/**
 * 读后端的标签版本号。不用全局 fetch：Next 会改写它并接入请求级缓存，轮询不在任何请求里
 * @returns {Promise<Record<string, string>>} 标签 → 版本号（从未变化过的标签不在里面）
 */
function fetchTagVersions() {
  const url = new URL(`${BACKEND_URL}/api/v1/misc/cache-tags`)
  const client = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = client.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`GET /misc/cache-tags: HTTP ${res.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(body)?.data?.tags ?? {})
        }
        catch (err) {
          reject(err)
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('GET /misc/cache-tags: timeout')))
    req.on('error', reject)
  })
}

function expiredTagsKey() {
  return `${state().prefix}next_cache:expired_tags`
}

/** 读一次后端的版本号；配置了 Redis 时顺带读其他副本 revalidateTag 的失效时间 */
async function syncOnce() {
  const s = state()
  try {
    s.versions = await fetchTagVersions()
  }
  catch (err) {
    // 取不到时沿用上一次的版本号，条目最多按各自的 revalidate 过期
    logError(err)
  }
  if (s.redis) {
    try {
      const shared = await s.redis.hgetall(expiredTagsKey())
      for (const [tag, at] of Object.entries(shared)) {
        if (Number(at) > (s.expiredAt.get(tag) ?? 0))
          s.expiredAt.set(tag, Number(at))
      }
    }
    catch (err) {
      logError(err)
    }
  }
  const now = Date.now()
  for (const [key, pending] of s.pending) {
    if (now - pending.at > PENDING_TTL_MS)
      s.pending.delete(key)
  }
}

/** @param {{ serverDistDir?: string }} ctx */
function start(ctx) {
  const s = state()
  if (s.started)
    return
  s.started = true
  // 构建期：不轮询、不连 Redis（镜像构建时连不上后端），与 Next 自带的缓存相同
  if (process.env.NEXT_PHASE === 'phase-production-build')
    return
  try {
    s.buildId = ctx.serverDistDir ? readFileSync(path.join(ctx.serverDistDir, '..', 'BUILD_ID'), 'utf8').trim() : ''
  }
  catch {
    s.buildId = ''
  }
  const url = process.env.REDIS_URL
  if (url) {
    // 连不上 Redis 时不影响页面：读取当作没有缓存、写入丢弃，限频记日志
    s.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 1000 })
    s.redis.on('error', logError)
  }
  const first = (s.redis ? s.redis.connect().catch(logError) : Promise.resolve()).then(syncOnce)
  s.ready = Promise.race([first, new Promise(resolve => setTimeout(resolve, FIRST_SYNC_TIMEOUT_MS).unref())]).then(() => {})
  first.finally(() => {
    const timer = setInterval(() => {
      void syncOnce()
    }, SYNC_INTERVAL_MS)
    timer.unref()
  })
}

/**
 * 条目自己的标签：取数结果是保存时的标签，页面与路由是生成时汇总的标签
 * @param {any} data
 * @returns {string[]} 标签列表
 */
function entryTags(data) {
  if (data?.value?.kind === 'FETCH')
    return data.value.tags ?? data.tags ?? []
  const header = data?.value?.headers?.[CACHE_TAGS_HEADER]
  return typeof header === 'string' && header ? header.split(',') : []
}

/**
 * 条目是否已经过期：依赖的后端数据版本号变了，或者某个标签被 revalidateTag 了
 * @param {any} data
 * @param {any} ctx
 */
function isExpired(data, ctx) {
  const s = state()
  const tags = entryTags(data)
  if (s.versions) {
    /** @type {Map<string, string>} */
    const recorded = new Map()
    for (const tag of tags) {
      if (tag.startsWith(VERSION_TAG_PREFIX)) {
        const rest = tag.slice(VERSION_TAG_PREFIX.length)
        const sep = rest.indexOf(':')
        recorded.set(rest.slice(0, sep), rest.slice(sep + 1))
      }
    }
    // 没有记下版本号的（本功能上线前写入的）同样当作过期
    for (const tag of tags) {
      if (BACKEND_TAGS.includes(tag) && recorded.get(tag) !== (s.versions[tag] ?? ''))
        return true
    }
  }
  if (s.expiredAt.size === 0)
    return false
  const lastModified = typeof data.lastModified === 'number' ? data.lastModified : 0
  const all = data?.value?.kind === 'FETCH' ? [...tags, ...(ctx?.tags ?? []), ...(ctx?.softTags ?? [])] : tags
  return all.some((tag) => {
    const at = s.expiredAt.get(tag)
    return at !== undefined && at > lastModified
  })
}

/**
 * 给要写入的条目记下版本号：用这个键上一次读取（缓存没命中或已过期，随后重新生成）时已知的版本号，
 * 而不是写入此刻的——生成期间才得知的修改，生成用的数据未必包含；记旧了只会让条目早一点过期
 * @param {string} key
 * @param {string[]} tags 条目自己的标签
 * @returns {string[]} 加上版本号标签后的标签
 */
function withVersionTags(key, tags) {
  const s = state()
  const pending = s.pending.get(key)
  s.pending.delete(key)
  const versions = pending && Date.now() - pending.at <= PENDING_TTL_MS ? pending.versions : s.versions
  const plain = tags.filter(tag => !tag.startsWith(VERSION_TAG_PREFIX))
  const backend = plain.filter(tag => BACKEND_TAGS.includes(tag))
  // 还不知道版本号（后端一直没连上）时记为「?」：之后取到版本号就会过期
  return [...plain, ...backend.map(tag => `${VERSION_TAG_PREFIX}${tag}:${versions ? (versions[tag] ?? '') : '?'}`)]
}

/**
 * @param {string} key
 * @param {any} data
 * @param {any} ctx
 * @returns {{ data: any, ctx: any }} 标签里加上版本号后的条目与上下文
 */
function stampVersions(key, data, ctx) {
  if (data?.kind === 'FETCH') {
    // 文件系统模式下内存里存的是 data 本身、磁盘上存的是 data + ctx.tags，两处都放上
    const tags = withVersionTags(key, ctx?.tags ?? [])
    return { data: { ...data, tags }, ctx: { ...ctx, tags } }
  }
  const header = data?.headers?.[CACHE_TAGS_HEADER]
  if (typeof header !== 'string' || !header)
    return { data, ctx }
  const tags = withVersionTags(key, header.split(','))
  return { data: { ...data, headers: { ...data.headers, [CACHE_TAGS_HEADER]: tags.join(',') } }, ctx }
}

// Redis 里的条目是 gzip 压缩的 JSON（文章页每种语言一条约 500 KB，压缩后约 180 KB，解压不到 1 毫秒）：
// Buffer（RSC 数据、路由响应体）与 Map（各路由段的预取数据）另外编码
/** @this {any} @param {string} key @param {unknown} value */
function replacer(key, value) {
  const raw = this[key]
  if (raw instanceof Map)
    return { __map: [...raw.entries()] }
  if (raw instanceof Uint8Array)
    return { __buf: Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('base64') }
  return value
}

/** @param {string} _key @param {any} value */
function reviver(_key, value) {
  if (value && typeof value === 'object') {
    if (typeof value.__buf === 'string')
      return Buffer.from(value.__buf, 'base64')
    if (Array.isArray(value.__map))
      return new Map(value.__map)
  }
  return value
}

/** @param {string} key */
function entryKey(key) {
  const s = state()
  // 带上构建号：滚动更新期间新旧版本共用一个 Redis，旧版本生成的页面引用的是旧的 JS 文件，不能给新版本用
  return `${s.prefix}next_cache:${s.buildId}:${key}`
}

/** @param {any} data @param {any} ctx */
function entryTTL(data, ctx) {
  const expire = ctx?.cacheControl?.expire
  if (data?.kind !== 'FETCH' && typeof expire === 'number' && expire > 0)
    return Math.min(MAX_ENTRY_TTL_SECONDS, Math.ceil(expire))
  return MAX_ENTRY_TTL_SECONDS
}

export default class NeoCacheHandler extends FileSystemCache {
  /** @param {any} ctx */
  constructor(ctx) {
    super(ctx)
    start(ctx)
  }

  /** @param {string} key @param {any} ctx */
  async get(key, ctx) {
    const s = state()
    await s.ready
    // 记下此刻已知的版本号，这个键接下来重新生成并写入时用（同一个键在一次生成期间可能被读多次，保留最早的那次）
    const pending = s.pending.get(key)
    if (!pending || Date.now() - pending.at > PENDING_TTL_MS)
      s.pending.set(key, { versions: s.versions, at: Date.now() })
    let data = null
    if (s.redis) {
      try {
        const raw = await s.redis.getBuffer(entryKey(key))
        data = raw ? JSON.parse(gunzipSync(raw).toString('utf8'), reviver) : null
      }
      catch (err) {
        logError(err)
      }
      // Redis 里没有的页面再看构建产物里预渲染好的那份（Redis 模式下文件系统里只有这些）
      if (!data && ctx?.kind !== 'FETCH')
        data = await super.get(key, ctx)
    }
    else {
      data = await super.get(key, ctx)
    }
    if (data && isExpired(data, ctx))
      return null
    return data
  }

  /** @param {string} key @param {any} data @param {any} ctx */
  async set(key, data, ctx) {
    // 404 页面不缓存：不存在的地址可以随手拼出无数个，缓存它们会让条目（文件系统模式下是 .next 里的文件）无限增长；
    // 每次照常渲染、向后端确认（不存在的数据同样不进取数缓存，见 src/lib/cache-tags.ts 的 UncachedNotFound）
    if (data?.kind === 'APP_PAGE' && data.status === 404) {
      state().pending.delete(key)
      return
    }
    const stamped = stampVersions(key, data, ctx)
    const s = state()
    if (!s.redis)
      return super.set(key, stamped.data, stamped.ctx)
    try {
      if (!stamped.data) {
        await s.redis.del(entryKey(key))
        return
      }
      const record = {
        lastModified: Date.now(),
        value: stamped.data,
        cacheControl: ctx?.fetchCache ? undefined : ctx?.cacheControl,
      }
      const body = gzipSync(JSON.stringify(record, replacer), { level: 1 })
      await s.redis.set(entryKey(key), body, 'EX', entryTTL(stamped.data, ctx))
    }
    catch (err) {
      logError(err)
    }
  }

  /**
   * 代码里调用 revalidateTag / revalidatePath 时：本进程照常更新 Next 自己的标签表；立即失效的（没有传 expire 或为 0）
   * 同时记下失效时间，配置了 Redis 时写进去让其他副本在下一次轮询时看到
   * @param {string | string[]} tags
   * @param {{ expire?: number } | undefined} durations
   */
  async revalidateTag(tags, durations) {
    await super.revalidateTag(tags, durations)
    if (durations?.expire)
      return
    const list = typeof tags === 'string' ? [tags] : tags
    const s = state()
    const now = Date.now()
    for (const tag of list)
      s.expiredAt.set(tag, now)
    if (s.redis && list.length > 0) {
      try {
        await s.redis.hset(expiredTagsKey(), ...list.flatMap(tag => [tag, String(now)]))
      }
      catch (err) {
        logError(err)
      }
    }
  }
}
