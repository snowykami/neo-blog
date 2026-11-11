// @ts-check
/*
 * 'use cache' 的缓存处理器（next.config.ts 的 cacheHandlers.default）：站点信息、文章、用户、分类等取数结果存在这里，
 * 各语言、各页面共用。按地址生成的整页缓存不在这里，见 cache-handler.mjs。
 *
 * 1. 失效：按后端缓存标签的版本号（轮询与比较见 cache-tag-versions.mjs）。写入时记下条目用到的后端标签在「这个键上一次没命中时」
 *    已知的版本号，读取时与最新的版本号比较，不同就当作没有缓存（Next 随即重新取数）。
 * 2. 存储：配置了 REDIS_URL 时存进 Redis（gzip 的 JSON，键按 Next 的缓存键做哈希；Next 的缓存键已含构建号，滚动更新时新旧版本不会混用），
 *    多个前端副本共用，TTL 取条目的 expire（最长 1 天）。没配置时用 Next 自带的进程内 LRU（与不配置 cacheHandlers 时相同：
 *    过了 revalidate 的条目当作没有，大小上限 50 MB），版本号以标签的形式（neo-ver:posts:<版本>）存在条目里。
 * 3. 不写进缓存：带「不存在」标签的结果（任意地址都能拼出来，见 src/lib/cache-tags.ts 的 CacheTag.NoStore），
 *    以及 expire 为 0 的（Next 视为按请求取的数据）。
 * 4. revalidateTag / updateTag（目前没人调用）一律按立即失效处理，配置了 Redis 时写进 Redis 让其他副本在下一次轮询时看到。
 *
 * 构建（next build）时也会加载：构建期不轮询、不连 Redis，用进程内 LRU。
 * 这个文件不经过打包，由 Next 在运行时直接 import，standalone 输出会自动带上它和 ioredis。
 * 依赖 Next 内部的默认处理器（next/dist/server/lib/cache-handlers/default.js）与流工具，升级 Next 时要复查。
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  expireTags,
  isTagExpiredSince,
  isVersionStale,
  latestExpiration,
  logError,
  NO_STORE_TAG,
  rememberRead,
  startTagSync,
  tagState,
  versionsForWrite,
} from './cache-tag-versions.mjs'

const require = createRequire(import.meta.url)
/** @type {{ createDefaultCacheHandler: (maxSize: number) => any }} */
const { createDefaultCacheHandler } = require('next/dist/server/lib/cache-handlers/default.js')
/** @type {{ streamFromBuffer: (chunk: Buffer) => ReadableStream<Uint8Array>, streamToBuffer: (stream: ReadableStream<Uint8Array>) => Promise<Buffer> }} */
const { streamFromBuffer, streamToBuffer } = require('next/dist/server/stream-utils/node-web-streams-helper.js')

// 与 Next 默认的 cacheMaxMemorySize 一致
const MEMORY_CACHE_SIZE = 50 * 1024 * 1024
const MAX_ENTRY_TTL_SECONDS = 24 * 3600
// 进程内模式下记录版本号的标签前缀（随条目保存在 Next 的 LRU 里，读取时去掉再交给 Next）
const VERSION_TAG_PREFIX = 'neo-ver:'
// 与页面缓存的键区分开（读取时记下的版本号放在同一张表里）
const PENDING_PREFIX = 'data:'

/**
 * @typedef {{ value: ReadableStream<Uint8Array>, tags: string[], stale: number, timestamp: number, expire: number, revalidate: number }} CacheEntry
 */

const memory = createDefaultCacheHandler(MEMORY_CACHE_SIZE)
startTagSync()
// 正在写入的键：同一个键的读取先等写入完成（与 Next 默认处理器相同），避免同一进程里重复取数
/** @type {Map<string, Promise<void>>} */
const pendingSets = new Map()

/** @param {CacheEntry} entry */
function shouldSkip(entry) {
  return entry.tags.includes(NO_STORE_TAG) || entry.expire === 0
}

/** @param {string} cacheKey */
function redisKey(cacheKey) {
  return `${tagState().prefix}use_cache:${createHash('sha256').update(cacheKey).digest('base64url')}`
}

/** @param {CacheEntry} entry */
function ttlSeconds(entry) {
  return Number.isFinite(entry.expire) && entry.expire > 0 ? Math.min(MAX_ENTRY_TTL_SECONDS, Math.ceil(entry.expire)) : MAX_ENTRY_TTL_SECONDS
}

/**
 * Redis 模式的读取
 * @param {string} cacheKey
 * @returns {Promise<CacheEntry | undefined>} 条目
 */
async function getFromRedis(cacheKey) {
  const redis = tagState().redis
  if (!redis)
    return undefined
  let record
  try {
    const raw = await redis.getBuffer(redisKey(cacheKey))
    if (!raw)
      return undefined
    record = JSON.parse(gunzipSync(raw).toString('utf8'))
  }
  catch (err) {
    logError(err)
    return undefined
  }
  if (isVersionStale(record.tags, record.versions ?? {}) || isTagExpiredSince(record.tags, record.timestamp))
    return undefined
  return {
    value: streamFromBuffer(Buffer.from(record.value, 'base64')),
    tags: record.tags,
    stale: record.stale,
    timestamp: record.timestamp,
    expire: record.expire,
    revalidate: record.revalidate,
  }
}

/**
 * 进程内模式的读取：版本号存在标签里，比较后去掉
 * @param {string} cacheKey
 * @param {string[]} softTags
 * @returns {Promise<CacheEntry | undefined>} 条目
 */
async function getFromMemory(cacheKey, softTags) {
  /** @type {CacheEntry | undefined} */
  const entry = await memory.get(cacheKey, softTags)
  if (!entry)
    return undefined
  /** @type {Record<string, string>} */
  const recorded = {}
  const tags = []
  for (const tag of entry.tags) {
    if (tag.startsWith(VERSION_TAG_PREFIX)) {
      const rest = tag.slice(VERSION_TAG_PREFIX.length)
      const sep = rest.indexOf(':')
      recorded[rest.slice(0, sep)] = rest.slice(sep + 1)
    }
    else {
      tags.push(tag)
    }
  }
  if (isVersionStale(tags, recorded) || isTagExpiredSince(tags, entry.timestamp)) {
    // 流已经交给我们了，丢弃前读掉，免得它挂着
    void entry.value.cancel()
    return undefined
  }
  return { ...entry, tags }
}

/** @type {any} */
const handler = {
  /**
   * @param {string} cacheKey
   * @param {string[]} softTags
   * @returns {Promise<CacheEntry | undefined>} 条目；没有或已失效时为 undefined
   */
  async get(cacheKey, softTags) {
    const pending = pendingSets.get(cacheKey)
    if (pending)
      await pending
    const entry = tagState().redis ? await getFromRedis(cacheKey) : await getFromMemory(cacheKey, softTags)
    if (!entry)
      rememberRead(PENDING_PREFIX + cacheKey)
    return entry
  },

  /**
   * @param {string} cacheKey
   * @param {Promise<CacheEntry>} pendingEntry
   */
  async set(cacheKey, pendingEntry) {
    /** @type {() => void} */
    let done = () => {}
    pendingSets.set(cacheKey, new Promise((resolve) => {
      done = () => resolve(undefined)
    }))
    try {
      const entry = await pendingEntry
      const versions = versionsForWrite(PENDING_PREFIX + cacheKey, entry.tags)
      if (shouldSkip(entry)) {
        void entry.value.cancel()
        return
      }
      const redis = tagState().redis
      if (!redis) {
        const versionTags = Object.entries(versions).map(([tag, version]) => `${VERSION_TAG_PREFIX}${tag}:${version}`)
        await memory.set(cacheKey, Promise.resolve({ ...entry, tags: [...entry.tags, ...versionTags] }))
        return
      }
      const value = await streamToBuffer(entry.value)
      const record = {
        value: value.toString('base64'),
        tags: entry.tags,
        versions,
        stale: entry.stale,
        timestamp: entry.timestamp,
        expire: entry.expire,
        revalidate: entry.revalidate,
      }
      await redis.set(redisKey(cacheKey), gzipSync(JSON.stringify(record), { level: 1 }), 'EX', ttlSeconds(entry))
    }
    catch (err) {
      // 生成中途出错（值不完整）或写入失败：丢弃，下次照常重新取
      logError(err)
    }
    finally {
      done()
      pendingSets.delete(cacheKey)
    }
  },

  // 每个请求第一次读取前调用：第一次轮询到版本号之前先等它（最多 1.5 秒），免得刚启动时把已经过期的条目当成有效
  async refreshTags() {
    startTagSync()
    await tagState().ready
  },

  /** @param {string[]} tags */
  async getExpiration(tags) {
    const local = tagState().redis ? 0 : await memory.getExpiration(tags)
    return Math.max(local, latestExpiration(tags))
  },

  /**
   * @param {string[]} tags
   * @param {{ expire?: number } | undefined} _durations
   */
  async updateTags(tags, _durations) {
    if (!tagState().redis)
      await memory.updateTags(tags)
    await expireTags(tags)
  },
}

export default handler
