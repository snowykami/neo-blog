// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

// 构建期模式：不轮询后端、不连 Redis，用 Next 自带的内存缓存（不写磁盘），版本号由测试直接设置
process.env.NEXT_PHASE = 'phase-production-build'

interface HandlerState { versions: Record<string, string> | null, pending: Map<string, unknown>, expiredAt: Map<string, number> }
interface CacheHandler {
  get: (key: string, ctx: Record<string, unknown>) => Promise<{ value: Record<string, unknown> } | null>
  set: (key: string, data: unknown, ctx: Record<string, unknown>) => Promise<void>
}

let Handler: new (ctx: Record<string, unknown>) => CacheHandler
const state = () => (globalThis as unknown as Record<symbol, HandlerState>)[Symbol.for('neo-blog.cache-handler')]

const fetchCtx = { kind: 'FETCH', tags: ['posts'], softTags: ['_N_T_/p/x'] }
const fetchValue = (body: string) => ({ kind: 'FETCH', data: { headers: {}, body, status: 200, url: '' }, revalidate: 60 })
const pageValue = (status: number, tags: string) => ({ kind: 'APP_PAGE', html: '<p>x</p>', rscData: undefined, headers: { 'x-next-cache-tags': tags }, postponed: undefined, status, segmentData: undefined })

function handler() {
  return new Handler({ dev: false, flushToDisk: false, maxMemoryCacheSize: 1 << 20, revalidatedTags: [], _requestHeaders: {} })
}

describe('缓存处理器：按后端标签版本号失效', () => {
  beforeAll(async () => {
    // 运行时由 Next 直接 import 的 .mjs（JSDoc 类型），这里按测试用到的方法收窄
    Handler = (await import('../../cache-handler.mjs')).default as unknown as typeof Handler
  })

  afterEach(() => {
    state().versions = null
    state().pending.clear()
    state().expiredAt.clear()
  })

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

  it('404 页面不缓存', async () => {
    const h = handler()
    state().versions = {}
    await h.set('/missing', pageValue(404, 'posts'), { cacheControl: { revalidate: 30 } })
    expect(await h.get('/missing', { kind: 'APP_PAGE' })).toBeNull()
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
