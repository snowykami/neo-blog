// @vitest-environment node
import type { Buffer } from 'node:buffer'
import http from 'node:http'
import process from 'node:process'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { isPublicPageRequest, resolveRendererHeaderValue, startRendererHeader } from './renderer-header'

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
let clearPageCacheL1: () => void
let clearUseCacheL1: () => void
let getRecordedRenderer: () => 'M' | 'R' | 'C' | null
let runWithRendererStore: <T>(fn: () => T) => T
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
  const cacheMod = await import('../../cache-handler.mjs')
  const tagMod = await import('../../cache-tag-versions.mjs')
  const useCacheMod = await import('../../use-cache-handler.mjs')
  Handler = cacheMod.default as unknown as typeof Handler
  clearPageCacheL1 = cacheMod.clearPageCacheL1 as () => void
  clearUseCacheL1 = useCacheMod.clearUseCacheL1 as () => void
  getRecordedRenderer = tagMod.getRecordedRenderer as () => 'M' | 'R' | 'C' | null
  runWithRendererStore = tagMod.runWithRendererStore as <T>(fn: () => T) => T
  useCache = useCacheMod.default as unknown as UseCacheHandler
})

afterEach(() => {
  state().versions = null
  state().pending.clear()
  state().expiredAt.clear()
  state().redis = null
  clearPageCacheL1()
  clearUseCacheL1()
  delete process.env.IMAGE_OPTIMIZE_HOSTS
  delete process.env.ENABLE_TELEMETRY
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

  it('redis 模式下变更运行时 IMAGE_OPTIMIZE_HOSTS 自动隔离页面缓存键', async () => {
    const store = new Map<string, Buffer>()
    state().redis = {
      getBuffer: async (k: string) => store.get(k) ?? null,
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

    delete process.env.IMAGE_OPTIMIZE_HOSTS
    await h.set('/img-page', pageValue(200, 'posts'), { cacheControl: { revalidate: 30 } })
    expect(await h.get('/img-page', { kind: 'APP_PAGE' })).not.toBeNull()

    process.env.IMAGE_OPTIMIZE_HOSTS = 'sfkm-blog.r2.liteyuki.org'
    // 新白名单对应不同的缓存键，不命中未开启优化前缓存的页面
    expect(await h.get('/img-page', { kind: 'APP_PAGE' })).toBeNull()
    await h.set('/img-page', pageValue(200, 'posts'), { cacheControl: { revalidate: 30 } })
    expect(await h.get('/img-page', { kind: 'APP_PAGE' })).not.toBeNull()

    // 换用等价顺序与格式的不同写法应命中同一指纹
    process.env.IMAGE_OPTIMIZE_HOSTS = 'https://sfkm-blog.r2.liteyuki.org/, extra.example.com'
    expect(await h.get('/img-page', { kind: 'APP_PAGE' })).toBeNull()
    await h.set('/img-page', pageValue(200, 'posts'), { cacheControl: { revalidate: 30 } })

    process.env.IMAGE_OPTIMIZE_HOSTS = 'extra.example.com, sfkm-blog.r2.liteyuki.org'
    expect(await h.get('/img-page', { kind: 'APP_PAGE' })).not.toBeNull()
  })
})

describe('页面缓存诊断响应头 renderer（M / R / C）', () => {
  it('未开 Redis 时：首次未命中标记 C，二次命中内存标记 M，标签版本过期回退标记 C', async () => {
    const h = handler()
    state().versions = { posts: 'v1' }

    const first = await runWithRendererStore(async () => {
      const entry = await h.get('/local-post', { kind: 'APP_PAGE' })
      expect(entry).toBeNull()
      return getRecordedRenderer()
    })
    expect(first).toBe('C')

    await h.set('/local-post', pageValue(200, 'posts'), { cacheControl: { revalidate: 30 } })

    const second = await runWithRendererStore(async () => {
      const entry = await h.get('/local-post', { kind: 'APP_PAGE' })
      expect(entry).not.toBeNull()
      expect((entry?.value.headers as Record<string, string>)?.renderer).toBeUndefined()
      return getRecordedRenderer()
    })
    expect(second).toBe('M')

    state().versions = { posts: 'v2' }
    const stale = await runWithRendererStore(async () => {
      const entry = await h.get('/local-post', { kind: 'APP_PAGE' })
      expect(entry).toBeNull()
      return getRecordedRenderer()
    })
    expect(stale).toBe('C')
  })

  it('开启 Redis 时：未命中标记 C → L1 命中标记 M → 清空 L1 后命中 Redis 标记 R → 版本失效标记 C', async () => {
    const store = new Map<string, Buffer>()
    let redisGets = 0
    state().redis = {
      getBuffer: async (k: string) => {
        redisGets++
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

    const cold = await runWithRendererStore(async () => {
      expect(await h.get('/redis-post', { kind: 'APP_PAGE' })).toBeNull()
      return getRecordedRenderer()
    })
    expect(cold).toBe('C')
    expect(redisGets).toBe(1)

    await h.set('/redis-post', pageValue(200, 'posts'), { cacheControl: { revalidate: 30 } })

    const memoryHit = await runWithRendererStore(async () => {
      const hit = await h.get('/redis-post', { kind: 'APP_PAGE' })
      expect(hit).not.toBeNull()
      expect((hit?.value.headers as Record<string, string>)?.renderer).toBeUndefined()
      return getRecordedRenderer()
    })
    expect(memoryHit).toBe('M')
    expect(redisGets).toBe(1)

    // 模拟切换到另一副本（本进程 L1 为空，Redis 已存有条目）
    clearPageCacheL1()
    const redisHit = await runWithRendererStore(async () => {
      const hit = await h.get('/redis-post', { kind: 'APP_PAGE' })
      expect(hit).not.toBeNull()
      return getRecordedRenderer()
    })
    expect(redisHit).toBe('R')
    expect(redisGets).toBe(2)

    // Redis 命中后已回填本进程 L1，再次请求走 M
    const rewarmedMemoryHit = await runWithRendererStore(async () => {
      expect(await h.get('/redis-post', { kind: 'APP_PAGE' })).not.toBeNull()
      return getRecordedRenderer()
    })
    expect(rewarmedMemoryHit).toBe('M')
    expect(redisGets).toBe(2)

    // 标签版本更新后：即便清空 L1 去读 Redis，旧条目被判过期仍记为 C
    clearPageCacheL1()
    state().versions = { posts: 'v2' }
    const expiredRedis = await runWithRendererStore(async () => {
      expect(await h.get('/redis-post', { kind: 'APP_PAGE' })).toBeNull()
      return getRecordedRenderer()
    })
    expect(expiredRedis).toBe('C')

    // htmlLimitedBots（如 curl -I）走 use-cache-handler 时同样遵循 C → M → R → C
    state().versions = { posts: 'v2' }
    expect(await runWithRendererStore(async () => {
      expect(await useCache.get('k-curl-post', [])).toBeUndefined()
      return getRecordedRenderer()
    })).toBe('C')

    await useCache.set('k-curl-post', useCacheEntry('body', ['posts']))
    expect(await runWithRendererStore(async () => {
      expect(await readText(await useCache.get('k-curl-post', []))).toBe('body')
      return getRecordedRenderer()
    })).toBe('M')

    clearUseCacheL1()
    expect(await runWithRendererStore(async () => {
      expect(await readText(await useCache.get('k-curl-post', []))).toBe('body')
      return getRecordedRenderer()
    })).toBe('R')

    state().versions = { posts: 'v3' }
    clearUseCacheL1()
    expect(await runWithRendererStore(async () => {
      expect(await useCache.get('k-curl-post', [])).toBeUndefined()
      return getRecordedRenderer()
    })).toBe('C')
  })

  it('同一请求多次读取按 C > R > M 收敛，且并发请求上下文互不串号', async () => {
    const store = new Map<string, Buffer>()
    state().redis = {
      getBuffer: async (k: string) => store.get(k) ?? null,
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

    await h.set('/warm-shell', pageValue(200, 'posts'), { cacheControl: { revalidate: 30 } })
    await h.set('/redis-only', pageValue(200, 'posts'), { cacheControl: { revalidate: 30 } })
    clearPageCacheL1()
    // 先把 /warm-shell 重新预热进 L1，使 /warm-shell 为 M、/redis-only 为 R、/cold-page 为 C
    await h.get('/warm-shell', { kind: 'APP_PAGE' })

    const mPlusR = await runWithRendererStore(async () => {
      await h.get('/warm-shell', { kind: 'APP_PAGE' })
      expect(getRecordedRenderer()).toBe('M')
      await h.get('/redis-only', { kind: 'APP_PAGE' })
      return getRecordedRenderer()
    })
    expect(mPlusR).toBe('R')

    const mPlusC = await runWithRendererStore(async () => {
      await h.get('/warm-shell', { kind: 'APP_PAGE' })
      await h.get('/cold-page', { kind: 'APP_PAGE' })
      await h.get('/warm-shell', { kind: 'APP_PAGE' })
      return getRecordedRenderer()
    })
    expect(mPlusC).toBe('C')

    // 并发请求各自隔离 AsyncLocalStorage，不会把冷渲染 C 串入并发的内存命中请求
    const [reqCold, reqMem] = await Promise.all([
      runWithRendererStore(async () => {
        await h.get('/concurrent-miss', { kind: 'APP_PAGE' })
        await new Promise(resolve => setTimeout(resolve, 10))
        return getRecordedRenderer()
      }),
      runWithRendererStore(async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        await h.get('/warm-shell', { kind: 'APP_PAGE' })
        return getRecordedRenderer()
      }),
    ])
    expect(reqCold).toBe('C')
    expect(reqMem).toBe('M')
  })

  it('路由过滤与 HTTP 响应头注入：仅对公开页面 HTML 与 RSC 输出 renderer，不影响 /api、/_next/static、/healthz 与 /console', async () => {
    expect(isPublicPageRequest({ method: 'GET', url: '/', headers: {} })).toBe(true)
    expect(isPublicPageRequest({ method: 'HEAD', url: '/p/hello-world', headers: {} })).toBe(true)
    expect(isPublicPageRequest({ method: 'GET', url: '/en/p/v1.0?_rsc=1a2b3', headers: { rsc: '1' } })).toBe(true)
    expect(isPublicPageRequest({ method: 'POST', url: '/p/hello-world', headers: { 'next-action': 'abc' } })).toBe(false)
    expect(isPublicPageRequest({ method: 'GET', url: '/api/v1/post/list', headers: {} })).toBe(false)
    expect(isPublicPageRequest({ method: 'GET', url: '/_next/static/chunks/main.js', headers: {} })).toBe(false)
    expect(isPublicPageRequest({ method: 'GET', url: '/_next/image?url=%2Ffoo.png&w=640&q=75', headers: {} })).toBe(false)
    expect(isPublicPageRequest({ method: 'GET', url: '/healthz', headers: {} })).toBe(false)
    expect(isPublicPageRequest({ method: 'GET', url: '/console/posts', headers: {} })).toBe(false)
    expect(isPublicPageRequest({ method: 'GET', url: '/en/console/global', headers: {} })).toBe(false)
    expect(isPublicPageRequest({ method: 'GET', url: '/p/hello/share-image', headers: {} })).toBe(false)
    expect(isPublicPageRequest({ method: 'GET', url: '/rss.xml', headers: {} })).toBe(false)

    expect(resolveRendererHeaderValue({ renderer: null }, 200, 'text/html; charset=utf-8')).toBe('C')
    expect(resolveRendererHeaderValue({ renderer: 'M' }, 200, 'text/x-component')).toBe('M')
    expect(resolveRendererHeaderValue({ renderer: 'R' }, 200, 'text/html')).toBe('R')
    expect(resolveRendererHeaderValue({ renderer: 'M' }, 200, 'application/json')).toBeNull()
    expect(resolveRendererHeaderValue({ renderer: null }, 307, '')).toBeNull()
    expect(resolveRendererHeaderValue({ renderer: 'M' }, 308, '')).toBe('M')

    startRendererHeader()
    const h = handler()
    state().versions = { posts: 'v1' }
    const server = http.createServer(async (req, res) => {
      if (req.url?.startsWith('/api/')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
        return
      }
      if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
        return
      }
      const cached = await h.get('/http-post', { kind: 'APP_PAGE' })
      if (!cached)
        await h.set('/http-post', pageValue(200, 'posts'), { cacheControl: { revalidate: 30 } })
      const isRsc = req.url?.includes('_rsc=')
      res.writeHead(200, { 'content-type': isRsc ? 'text/x-component' : 'text/html; charset=utf-8' })
      res.end('ok')
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const addr = server.address() as { port: number }
      const base = `http://127.0.0.1:${addr.port}`

      const r1 = await fetch(`${base}/p/http-post`)
      expect(r1.headers.get('renderer')).toBe('C')

      const r2 = await fetch(`${base}/p/http-post`)
      expect(r2.headers.get('renderer')).toBe('M')

      const rRsc = await fetch(`${base}/p/http-post?_rsc=xyz`, { headers: { rsc: '1' } })
      expect(rRsc.headers.get('renderer')).toBe('M')

      const rApi = await fetch(`${base}/api/v1/info`)
      expect(rApi.headers.get('renderer')).toBeNull()

      const rHealth = await fetch(`${base}/healthz`)
      expect(rHealth.headers.get('renderer')).toBeNull()
    }
    finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
