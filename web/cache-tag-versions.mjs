// @ts-check
/*
 * 后端缓存标签的版本号：页面缓存（cache-handler.mjs，next.config.ts 的 cacheHandler）与 'use cache' 的取数缓存
 * （use-cache-handler.mjs，cacheHandlers.default）共用这里的轮询与进程内状态。
 *
 * 1. 失效：后端数据变化时换掉对应标签的版本号（internal/repo/cache_tag.go），本进程每 3 秒读一次（GET /misc/cache-tags）。
 *    写入条目时记下「当时已知的版本号」，读取时与最新的版本号比较，不同就当作没有缓存，下次访问重新取数、重新生成。
 *    按版本号而不是按时间比较：几个副本得知修改有先后，还没得知的副本即使在别的副本之后写入了旧内容，它记下的也是旧版本号，
 *    其他副本一读就知道已经过期；也不受各台机器时钟误差的影响。
 *    用轮询而不是后端主动通知：后端不用知道前端地址、不用共享密钥，多个前端副本各自轮询，没有 Redis 时也都能失效。
 *    标签只到数据种类（见 src/lib/cache-tags.ts），接口不透露具体是哪篇文章。
 * 2. 记下的是「读取时（缓存没命中、随后重新生成）」的版本号而不是写入时的：生成期间才得知的修改，生成用的数据未必包含；
 *    记旧了只会让条目早一点过期。
 * 3. 配置了 REDIS_URL（与后端、运行时指标共用，键前缀 REDIS_KEY_PREFIX）时两个缓存都存进 Redis，多个前端副本共用；
 *    代码里调用 revalidateTag / updateTag（目前没有）时按时间失效，写进 Redis 让其他副本在下一次轮询时看到。
 *
 * 构建（next build）时也会加载：构建期不轮询、不连 Redis（镜像构建时连不上后端），与 Next 自带的缓存相同。
 * 这个文件不经过打包，由两个缓存处理器在运行时直接 import，standalone 输出会自动带上它和 ioredis。
 */
import http from 'node:http'
import https from 'node:https'
import process from 'node:process'
import { Redis } from 'ioredis'

const SYNC_INTERVAL_MS = 3000
// 首次读取版本号的最长等待：在此之前的缓存读取先等它，避免刚启动时把已经过期的条目当成有效
const FIRST_SYNC_TIMEOUT_MS = 1500
const REQUEST_TIMEOUT_MS = 2000
// 读取到写入之间记下的版本号最多保留多久：一次生成不会比这更久，过期的说明这次读取之后没有重新生成
const PENDING_TTL_MS = 30_000
const ERROR_LOG_INTERVAL_MS = 60_000
const DEFAULT_REDIS_PREFIX = 'neo-blog:'

/** 依赖后端数据的标签，与 src/lib/cache-tags.ts 的 CacheTag、后端 repo.CacheTags 一致 */
export const BACKEND_TAGS = ['posts', 'pages', 'users', 'site']
/** 不存在的内容（404）的标签，与 src/lib/cache-tags.ts 的 CacheTag.NoStore 一致：带它的取数结果与页面都不写进缓存 */
export const NO_STORE_TAG = 'neo-nostore'

/** 构建期：不轮询、不连 Redis */
export const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'

// 与 src/api/client.ts 的 BACKEND_URL 一致
const BACKEND_URL = (process.env.BACKEND_URL
  || (process.env.NODE_ENV === 'production' ? 'http://neo-blog-backend:8888' : 'http://localhost:8888')).replace(/\/+$/, '')

/**
 * 跨请求的状态放在 globalThis 上：页面缓存处理器每个请求 new 一个，两个处理器也是分别加载的模块
 * @typedef {{
 *   started: boolean,
 *   ready: Promise<void>,
 *   redis: Redis | null,
 *   prefix: string,
 *   versions: Record<string, string> | null,
 *   pending: Map<string, { versions: Record<string, string> | null, at: number }>,
 *   expiredAt: Map<string, number>,
 *   lastErrorAt: number,
 *   syncSeq: number,
 *   appliedSyncSeq: number,
 *   syncNow: () => Promise<void>,
 * }} TagState
 */
const STATE_KEY = Symbol.for('neo-blog.cache-tag-versions')

/** @returns {TagState} 本进程共用的状态 */
export function tagState() {
  const holder = /** @type {Record<symbol, TagState | undefined>} */ (/** @type {unknown} */ (globalThis))
  holder[STATE_KEY] ??= {
    started: false,
    ready: Promise.resolve(),
    redis: null,
    prefix: process.env.REDIS_KEY_PREFIX || DEFAULT_REDIS_PREFIX,
    // 后端各标签的最新版本号；还没取到时为 null，此时不按版本号判断
    versions: null,
    // 读取时记下的版本号，写入同一个键时用它（见 versionsForWrite）
    pending: new Map(),
    // revalidateTag / updateTag 的失效时间
    expiredAt: new Map(),
    lastErrorAt: 0,
    // 每次读取版本号加一；只采用比已采用的更晚发出的读取结果，避免轮询的旧结果覆盖 syncNow 刚读到的新版本号
    syncSeq: 0,
    appliedSyncSeq: 0,
    // 立刻读一次版本号：经前端转发的写请求成功后调用（见 app/api/v1/[...path]/route.ts），不必等下一次轮询。
    // 放在共享状态上而不是让路由 import 本文件：路由会被打包，本文件由缓存处理器在运行时直接加载
    syncNow: () => syncOnce(),
  }
  return holder[STATE_KEY]
}

/** @param {unknown} err */
export function logError(err) {
  const s = tagState()
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

export function expiredTagsKey() {
  return `${tagState().prefix}next_cache:expired_tags`
}

/** 读一次后端的版本号；配置了 Redis 时顺带读其他副本 revalidateTag 的失效时间 */
async function syncOnce() {
  const s = tagState()
  const seq = ++s.syncSeq
  try {
    const versions = await fetchTagVersions()
    if (seq > s.appliedSyncSeq) {
      s.appliedSyncSeq = seq
      s.versions = versions
    }
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

/** 开始轮询（每个进程只开始一次）；配置了 REDIS_URL 时连接 Redis */
export function startTagSync() {
  const s = tagState()
  if (s.started)
    return
  s.started = true
  if (isBuildPhase)
    return
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
 * 缓存没命中（或已过期）时调用：记下此刻已知的版本号，这个键接下来重新生成并写入时用
 * （同一个键在一次生成期间可能被读多次，保留最早的那次）
 * @param {string} key 带种类前缀的键，两个缓存不会撞上
 */
export function rememberRead(key) {
  const s = tagState()
  const pending = s.pending.get(key)
  if (!pending || Date.now() - pending.at > PENDING_TTL_MS)
    s.pending.set(key, { versions: s.versions, at: Date.now() })
}

/** @param {string} key */
export function forgetRead(key) {
  tagState().pending.delete(key)
}

/**
 * 写入时要记下的版本号：用这个键上一次读取时已知的版本号，而不是写入此刻的
 * @param {string} key
 * @param {string[]} tags 条目的标签
 * @returns {Record<string, string>} 条目用到的后端标签 → 版本号；还不知道版本号（后端一直没连上）时记为「?」，之后取到版本号就会过期
 */
export function versionsForWrite(key, tags) {
  const s = tagState()
  const pending = s.pending.get(key)
  s.pending.delete(key)
  const versions = pending && Date.now() - pending.at <= PENDING_TTL_MS ? pending.versions : s.versions
  /** @type {Record<string, string>} */
  const result = {}
  for (const tag of tags) {
    if (BACKEND_TAGS.includes(tag))
      result[tag] = versions ? (versions[tag] ?? '') : '?'
  }
  return result
}

/**
 * 条目记下的版本号是否已经过时；还没取到最新版本号时不按版本号判断。
 * 没有记下某个后端标签的版本号（本功能上线前写入的）同样当作过时
 * @param {string[]} tags 条目的标签
 * @param {Record<string, string>} recorded 写入时记下的版本号
 */
export function isVersionStale(tags, recorded) {
  const s = tagState()
  if (!s.versions)
    return false
  return tags.some(tag => BACKEND_TAGS.includes(tag) && recorded[tag] !== (s.versions?.[tag] ?? ''))
}

/**
 * 某个标签在 timestamp 之后被 revalidateTag / updateTag 过
 * @param {string[]} tags
 * @param {number} timestamp 条目的写入时间（毫秒）
 */
export function isTagExpiredSince(tags, timestamp) {
  const s = tagState()
  if (s.expiredAt.size === 0)
    return false
  return tags.some((tag) => {
    const at = s.expiredAt.get(tag)
    return at !== undefined && at > timestamp
  })
}

/** @param {string[]} tags 这些标签里最近一次被 revalidateTag / updateTag 的时间（毫秒），没有时为 0 */
export function latestExpiration(tags) {
  const s = tagState()
  let latest = 0
  for (const tag of tags)
    latest = Math.max(latest, s.expiredAt.get(tag) ?? 0)
  return latest
}

/**
 * 代码里调用 revalidateTag / updateTag 时：记下失效时间，配置了 Redis 时写进去让其他副本在下一次轮询时看到
 * @param {string[]} tags
 */
export async function expireTags(tags) {
  const s = tagState()
  const now = Date.now()
  for (const tag of tags)
    s.expiredAt.set(tag, now)
  if (s.redis && tags.length > 0) {
    try {
      await s.redis.hset(expiredTagsKey(), ...tags.flatMap(tag => [tag, String(now)]))
    }
    catch (err) {
      logError(err)
    }
  }
}
