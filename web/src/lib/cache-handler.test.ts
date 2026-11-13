// @vitest-environment node
import type { Buffer } from 'node:buffer'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

// 构建期模式：不轮询后端、不连 Redis，用 Next 自带的内存缓存（不写磁盘），版本号由测试直接设置
process.env.NEXT_PHASE = 'phase-production-build'

interface TagState {
  versions: Record<string, string> | null
  pending: Map<string, unknown>
  expiredAt: Map<string, number>
  redis: unknown
}
interface CacheHandler {
  get: (key: string, ctx: Record<string, unknown>) => Promise<{ value: Record<string, unknown> } | null>
  set: (key: string, data: unknown, ctx: Record<string, unknown>) => Promise<void>
}
interface UseCacheEntry { value: ReadableStream<Uint8Array>, tags: string[], stale: number, timestamp: number, expire: number, revalidate: number }
interface UseCacheHandler {
  get: (key: string, softTags: string[]) => Promise<UseCacheEntry | undefined>
  set: (key: string, entry: Promise<UseCacheEntry>) => Promise<void>
}

let Handler: new (ctx: Record<string, unknown>) => CacheHandler
let useCache: UseCacheHandler
const state = () => (globalThis as unknown as Record<symbol, TagState>)[Symbol.for('neo-blog.cache-tag-versions')]

const fetchCtx = { kind: 'FETCH', tags: ['posts'], softTags: ['_N_T_/p/x'] }
const fetchValue = (body: string) => ({ kind: 'FETCH', data: { headers: {}, body, status: 200, url: '' }, revalidate: 60 })
const pageValue = (status: number, tags: string) => ({ kind: 'APP_PAGE', html: '<p>x</p>', rscData: undefined, headers: { 'x-next-cache-tags': tags }, postponed: undefined, status, segmentData: undefined })

function handler() {
  return new Handler({ dev: false, flushToDisk: false, maxMemoryCacheSize: 1 << 20, revalidatedTags: [], _requestHeaders: {} })
}

function useCacheEntry(text: string, tags: string[], expire = 3600): Promise<UseCacheEntry> {
  return Promise.resolve({
    value: new Response(text).body as ReadableStream<Uint8Array>,
    tags,
    stale: 300,
    timestamp: Date.now(),
    expire,
    revalidate: 30,
  })
}

async function readText(entry: UseCacheEntry | undefined) {
  return entry ? new Response(entry.value).text() : undefined
}

beforeAll(async () => {
  // 运行时由 Next 直接 import 的 .mjs（JSDoc 类型），这里按测试用到的方法收窄
  Handler = (await import('../../cache-handler.mjs')).default as unknown as typeof Handler
  useCache = (await import('../../use-cache-handler.mjs')).default as unknown as UseCacheHandler
})

afterEach(() => {
  state().versions = null
  state().pending.clear()
  state().expiredAt.clear()
  state().redis = null
})

describe('页面缓存处理器：按后端标签版本号失效', () => {
  it('写入时记下读取那一刻的版本号，版本变了就当作没有缓存', async () => {
    const h = handler()
    state().versions = { posts: 'v1' }
    expect(await h.get('fetch-a', fetchCtx)).toBeNull()
    await h.set('fetch-a', fetchValue('"a"'), { fetchCache: true, tags: ['posts'] })
    const hit = await h.get('fetch-a', fetchCtx)
    expect(hit?.value.tags).toContain('neo-ver:posts:v1')

    state().versions = { posts: 'v2' }
    expect(await h.get('fetch-a', fetchCtx)).toBeNull()
  })

  it('读取之后才得知的修改：写入的条目仍记旧版本号，随即过期', async () => {
    const h = handler()
    state().versions = { posts: 'v1' }
    expect(await h.get('fetch-b', fetchCtx)).toBeNull()
    // 生成期间轮询到了新版本，生成用的数据可能是旧的
    state().versions = { posts: 'v2' }
    await h.set('fetch-b', fetchValue('"old"'), { fetchCache: true, tags: ['posts'] })
    expect(await h.get('fetch-b', fetchCtx)).toBeNull()
  })

  it('页面按汇总的标签判断，与后端无关的标签不受影响', async () => {
    const h = handler()
    state().versions = { posts: 'v1', site: 's1' }
    await h.get('/page-a', { kind: 'APP_PAGE' })
    await h.set('/page-a', pageValue(200, 'posts,site,_N_T_/layout'), { cacheControl: { revalidate: 30 } })
    expect(await h.get('/page-a', { kind: 'APP_PAGE' })).not.toBeNull()

    state().versions = { posts: 'v1', site: 's2' }
    expect(await h.get('/page-a', { kind: 'APP_PAGE' })).toBeNull()

    await h.set('/page-b', pageValue(200, '_N_T_/layout'), { cacheControl: { revalidate: 30 } })
    state().versions = { posts: 'v9', site: 's9' }
    expect(await h.get('/page-b', { kind: 'APP_PAGE' })).not.toBeNull()
  })

  it('404 页面与用到「不存在」取数结果的页面不缓存', async () => {
    const h = handler()
    state().versions = {}
    await h.set('/missing', pageValue(404, 'posts'), { cacheControl: { revalidate: 30 } })
    expect(await h.get('/missing', { kind: 'APP_PAGE' })).toBeNull()
    await h.set('/with-missing-data', pageValue(200, 'posts,neo-nostore'), { cacheControl: { revalidate: 30 } })
    expect(await h.get('/with-missing-data', { kind: 'APP_PAGE' })).toBeNull()
  })

  it('还没取到版本号时不按版本号判断；取到后，之前写入的条目过期', async () => {
    const h = handler()
    await h.get('fetch-c', fetchCtx)
    await h.set('fetch-c', fetchValue('"c"'), { fetchCache: true, tags: ['posts'] })
    expect(await h.get('fetch-c', fetchCtx)).not.toBeNull()
    state().versions = {}
    expect(await h.get('fetch-c', fetchCtx)).toBeNull()
  })
})

describe('\'use cache\' 处理器（进程内模式）：按后端标签版本号失效', () => {
  it('写入时记下没命中那一刻的版本号，版本变了就当作没有缓存；交给 Next 的标签里不带版本号', async () => {
    state().versions = { site: 's1' }
    expect(await useCache.get('k-site', [])).toBeUndefined()
    await useCache.set('k-site', useCacheEntry('site-v1', ['site']))
    const hit = await useCache.get('k-site', [])
    expect(hit?.tags).toEqual(['site'])
    expect(await readText(hit)).toBe('site-v1')

    state().versions = { site: 's2' }
    expect(await useCache.get('k-site', [])).toBeUndefined()
  })

  it('读取之后才得知的修改：写入的条目仍记旧版本号，随即过期', async () => {
    state().versions = { posts: 'v1' }
    expect(await useCache.get('k-post', [])).toBeUndefined()
    state().versions = { posts: 'v2' }
    await useCache.set('k-post', useCacheEntry('old', ['posts']))
    expect(await useCache.get('k-post', [])).toBeUndefined()
  })

  it('「不存在」的结果与 expire 为 0 的结果不写进缓存', async () => {
    state().versions = {}
    await useCache.set('k-missing', useCacheEntry('null', ['posts', 'neo-nostore']))
    expect(await useCache.get('k-missing', [])).toBeUndefined()
    await useCache.set('k-dynamic', useCacheEntry('x', [], 0))
    expect(await useCache.get('k-dynamic', [])).toBeUndefined()
  })

  it('与后端无关的条目不受版本号影响', async () => {
    state().versions = { posts: 'v1' }
    await useCache.set('k-theme', useCacheEntry('theme', []))
    state().versions = { posts: 'v2', site: 's9' }
    expect(await readText(await useCache.get('k-theme', []))).toBe('theme')
  })

  it('redis 模式下热命中走进程内 L1，版本号变化时立即失效', async () => {
    const store = new Map<string, Buffer>()
    let gets = 0
    state().redis = {
      getBuffer: async (k: string) => {
        gets++
        return store.get(k) ?? null
      },
      set: async (k: string, v: Buffer) => {
        store.set(k, v)
        return 'OK'
      },
      del: async (k: string) => {
        store.delete(k)
        return 1
      },
    }
    state().versions = { posts: 'v1' }

    const h = handler()
    expect(await h.get('/redis-page', { kind: 'APP_PAGE' })).toBeNull()
    expect(gets).toBe(1)
    await h.set('/redis-page', pageValue(200, 'posts'), { cacheControl: { revalidate: 30 } })
    expect(await h.get('/redis-page', { kind: 'APP_PAGE' })).not.toBeNull()
    // L1 命中，不再触发 Redis getBuffer
    expect(gets).toBe(1)

    // use-cache 同理：可被多次消费流且不重复读 Redis
    expect(await useCache.get('k-redis-post', [])).toBeUndefined()
    expect(gets).toBe(2)
    await useCache.set('k-redis-post', useCacheEntry('post-body', ['posts']))
    expect(await readText(await useCache.get('k-redis-post', []))).toBe('post-body')
    expect(await readText(await useCache.get('k-redis-post', []))).toBe('post-body')
    expect(gets).toBe(2)

    // 版本变化后 L1 与 Redis 中的旧条目均失效
    state().versions = { posts: 'v2' }
    expect(await h.get('/redis-page', { kind: 'APP_PAGE' })).toBeNull()
    expect(await useCache.get('k-redis-post', [])).toBeUndefined()
  })
})
