/*
 * Next.js 的页面缓存处理器（next.config.ts 的 cacheHandler）：按地址生成的完整页面（ISR）与各路由的 App Shell、
 * 按段拆开的预取数据都存在这里。'use cache' 的取数结果不在这里，见 use-cache-handler.mjs（cacheHandlers.default）。
 *
 * 1. 失效：按后端缓存标签的版本号（轮询与比较见 cache-tag-versions.mjs）。页面条目的标签由 Next 从页面里用到的 'use cache'
 *    汇总而来（x-next-cache-tags），写入时把当时已知的版本号以标签的形式（neo-ver:posts:<版本>）混在里面一起保存，
 *    读取时与最新的版本号比较，不同就当作没有缓存，下次访问重新生成（页面的标签不会发给浏览器）。
 * 2. 存储：配置了 REDIS_URL 时条目存进 Redis，多个前端副本共用，一个副本生成过的页面其他副本直接用；同时在本进程保留有上限的
 *    L1 内存 LRU，热页面直接命中内存，省去每次请求的 Redis 往返、解压与反序列化（仍每次校验标签版本号，失效延迟不变）。
 *    没配置时沿用 Next 自带的文件系统缓存（内存 LRU + .next 目录），只在本进程内有效；
 *    上次运行时留下的条目同样按版本号判断，期间后端改过的不会再用。
 * 3. 404 页面与用到「不存在」取数结果的页面不缓存（任意地址都能拼出来，缓存会无限增长）。
 * 4. 代码里调用 revalidateTag / revalidatePath（目前没有）时按时间失效，配置了 Redis 时写进 Redis 让其他副本在下一次轮询时看到。
 *
 * 构建（next build）时也会加载这个文件：构建期不轮询、不连 Redis，行为与 Next 自带的缓存相同。
 * 这个文件不经过打包，由 Next 在运行时直接 import，standalone 输出会自动带上它和 ioredis。
 * 依赖 Next 内部的 FileSystemCache（next/dist/server/lib/incremental-cache/file-system-cache.js），升级 Next 时要复查。
 */
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { gunzip as gunzipCb, gzip as gzipCb } from 'node:zlib'
import {
  expireTags,
  forgetRead,
  isBuildPhase,
  isTagExpiredSince,
  isVersionStale,
  logError,
  NO_STORE_TAG,
  rememberRead,
  startTagSync,
  tagState,
  versionsForWrite,
} from './cache-tag-versions.mjs'

const gunzip = promisify(gunzipCb)
const gzip = promisify(gzipCb)

const require = createRequire(import.meta.url)
/** @type {any} */
const FileSystemCache = require('next/dist/server/lib/incremental-cache/file-system-cache.js').default

// Redis 中条目的最长保存时间：长时间没人访问的页面过期后重新生成
const MAX_ENTRY_TTL_SECONDS = 24 * 3600
const CACHE_TAGS_HEADER = 'x-next-cache-tags'
// 记录版本号的标签前缀：混在条目自己的标签里，随条目一起保存
const VERSION_TAG_PREFIX = 'neo-ver:'
// 与 'use cache' 的键区分开（读取时记下的版本号放在同一张表里）
const PENDING_PREFIX = 'page:'

// Redis 模式下的进程内 L1 LRU 上限：避免高并发热路径每次都走 Redis + gunzip + JSON.parse
const L1_MAX_ENTRIES = 200
const L1_MAX_BYTES = 32 * 1024 * 1024
/** @type {Map<string, { record: any, size: number, expiresAt: number }>} */
const redisL1 = new Map()
let redisL1Bytes = 0

// 构建号：Redis 里的页面键带上它，滚动更新期间新旧版本共用一个 Redis，旧版本生成的页面引用的是旧的 JS 文件，不能给新版本用
let buildId = ''

/** @param {string} rKey */
function l1Delete(rKey) {
  const existing = redisL1.get(rKey)
  if (!existing)
    return
  redisL1.delete(rKey)
  redisL1Bytes = Math.max(0, redisL1Bytes - existing.size)
}

/**
 * @param {string} rKey
 * @param {any} ctx
 */
function l1Get(rKey, ctx) {
  const existing = redisL1.get(rKey)
  if (!existing)
    return null
  if (Date.now() >= existing.expiresAt || isExpired(existing.record, ctx)) {
    l1Delete(rKey)
    return null
  }
  redisL1.delete(rKey)
  redisL1.set(rKey, existing)
  return existing.record
}

/**
 * @param {string} rKey
 * @param {any} record
 * @param {number} size
 * @param {number} ttlSeconds
 */
function l1Set(rKey, record, size, ttlSeconds) {
  if (size <= 0 || size > (L1_MAX_BYTES >> 2) || ttlSeconds <= 0)
    return
  l1Delete(rKey)
  while (redisL1.size >= L1_MAX_ENTRIES || (redisL1.size > 0 && redisL1Bytes + size > L1_MAX_BYTES)) {
    const oldest = redisL1.keys().next().value
    if (oldest === undefined)
      break
    l1Delete(oldest)
  }
  redisL1.set(rKey, { record, size, expiresAt: Date.now() + ttlSeconds * 1000 })
  redisL1Bytes += size
}

/**
 * 条目自己的标签：取数结果（FETCH，Cache Components 下已不用）是保存时的标签，页面与路由是生成时汇总的标签
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
  const tags = entryTags(data)
  /** @type {Record<string, string>} */
  const recorded = {}
  for (const tag of tags) {
    if (tag.startsWith(VERSION_TAG_PREFIX)) {
      const rest = tag.slice(VERSION_TAG_PREFIX.length)
      const sep = rest.indexOf(':')
      recorded[rest.slice(0, sep)] = rest.slice(sep + 1)
    }
  }
  if (isVersionStale(tags, recorded))
    return true
  const lastModified = typeof data.lastModified === 'number' ? data.lastModified : 0
  const all = data?.value?.kind === 'FETCH' ? [...tags, ...(ctx?.tags ?? []), ...(ctx?.softTags ?? [])] : tags
  return isTagExpiredSince(all, lastModified)
}

/**
 * 给要写入的条目记下版本号：用这个键上一次读取（缓存没命中或已过期，随后重新生成）时已知的版本号
 * @param {string} key
 * @param {string[]} tags 条目自己的标签
 * @returns {string[]} 加上版本号标签后的标签
 */
function withVersionTags(key, tags) {
  const plain = tags.filter(tag => !tag.startsWith(VERSION_TAG_PREFIX))
  const versions = versionsForWrite(PENDING_PREFIX + key, plain)
  return [...plain, ...Object.entries(versions).map(([tag, version]) => `${VERSION_TAG_PREFIX}${tag}:${version}`)]
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
  if (typeof header !== 'string' || !header) {
    forgetRead(PENDING_PREFIX + key)
    return { data, ctx }
  }
  const tags = withVersionTags(key, header.split(','))
  return { data: { ...data, headers: { ...data.headers, [CACHE_TAGS_HEADER]: tags.join(',') } }, ctx }
}

/**
 * 不写进缓存的页面：404（不存在的地址可以随手拼出无数个），以及用到了「不存在」取数结果的页面（见 src/lib/cache-tags.ts 的 CacheTag.NoStore）
 * @param {any} data
 */
function shouldSkip(data) {
  if (data?.kind !== 'APP_PAGE')
    return false
  if (data.status === 404)
    return true
  const header = data.headers?.[CACHE_TAGS_HEADER]
  return typeof header === 'string' && header.split(',').includes(NO_STORE_TAG)
}

// Redis 里的条目是 gzip 压缩的 JSON（文章页每种语言一条约 500 KB，压缩后约 180 KB，异步解压不阻塞事件循环）：
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
  return `${tagState().prefix}next_cache:${buildId}:${key}`
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
    startTagSync()
    if (!buildId && !isBuildPhase) {
      try {
        buildId = ctx.serverDistDir ? readFileSync(path.join(ctx.serverDistDir, '..', 'BUILD_ID'), 'utf8').trim() : ''
      }
      catch {
        buildId = ''
      }
    }
  }

  /** @param {string} key @param {any} ctx */
  async get(key, ctx) {
    const s = tagState()
    await s.ready
    // 记下此刻已知的版本号，这个键接下来重新生成并写入时用
    rememberRead(PENDING_PREFIX + key)
    let data = null
    if (s.redis) {
      const rKey = entryKey(key)
      const cached = l1Get(rKey, ctx)
      if (cached)
        return cached
      try {
        const raw = await s.redis.getBuffer(rKey)
        if (raw) {
          const unzipped = await gunzip(raw)
          const parsed = JSON.parse(unzipped.toString('utf8'), reviver)
          if (parsed && !isExpired(parsed, ctx)) {
            l1Set(rKey, parsed, unzipped.byteLength, entryTTL(parsed.value, ctx))
            return parsed
          }
        }
      }
      catch (err) {
        logError(err)
      }
      // Redis 里没有的页面再看构建产物里预渲染好的那份（Redis 模式下文件系统里只有这些）
      if (ctx?.kind !== 'FETCH')
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
    // 每次照常渲染、向后端确认（不存在的数据同样不进取数缓存，见 src/lib/cache-tags.ts 的 CacheTag.NoStore）
    if (shouldSkip(data)) {
      forgetRead(PENDING_PREFIX + key)
      return
    }
    const stamped = stampVersions(key, data, ctx)
    const s = tagState()
    if (!s.redis)
      return super.set(key, stamped.data, stamped.ctx)
    const rKey = entryKey(key)
    try {
      if (!stamped.data) {
        l1Delete(rKey)
        await s.redis.del(rKey)
        return
      }
      const record = {
        lastModified: Date.now(),
        value: stamped.data,
        cacheControl: ctx?.fetchCache ? undefined : ctx?.cacheControl,
      }
      const ttl = entryTTL(stamped.data, ctx)
      const json = JSON.stringify(record, replacer)
      const body = await gzip(json, { level: 1 })
      await s.redis.set(rKey, body, 'EX', ttl)
      l1Set(rKey, record, Buffer.byteLength(json), ttl)
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
    await expireTags(typeof tags === 'string' ? [tags] : tags)
  }
}
