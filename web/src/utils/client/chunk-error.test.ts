import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isChunkLoadError, reloadForChunkError } from './chunk-error'

describe('isChunkLoadError', () => {
  it('recognizes chunk load failures from turbopack, webpack and dynamic import', () => {
    const turbopack = new Error('Failed to load chunk /_next/static/chunks/abc.js from module 123')
    turbopack.name = 'ChunkLoadError'
    expect(isChunkLoadError(turbopack)).toBe(true)
    expect(isChunkLoadError(new Error('Loading chunk 42 failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Loading CSS chunk app-layout failed.'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/_next/a.js'))).toBe(true)
    expect(isChunkLoadError(new Error('Module 995741 was instantiated because it was required from module 677572, but the module factory is not available.'))).toBe(true)
    expect(isChunkLoadError(new Error('Module 995741 was instantiated as a runtime entry of chunk /_next/static/chunks/abc.js, but the module factory is not available.'))).toBe(true)
    // 被包装后的错误沿 cause 查找
    expect(isChunkLoadError(new Error('render failed', { cause: turbopack }))).toBe(true)
  })

  it('ignores other errors', () => {
    expect(isChunkLoadError(new Error('Network Error'))).toBe(false)
    expect(isChunkLoadError(new Error('Module [project]/src/a.tsx was instantiated because of an HMR update, but the module factory is not available.'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError('Failed to load chunk')).toBe(false)
  })
})

describe('reloadForChunkError', () => {
  const reload = vi.fn()

  beforeEach(() => {
    sessionStorage.clear()
    reload.mockClear()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('reloads once and skips repeated reloads within the cooldown', () => {
    vi.useFakeTimers()
    expect(reloadForChunkError()).toBe(true)
    expect(reloadForChunkError()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)

    // 冷却期过后可以再次刷新
    vi.advanceTimersByTime(61_000)
    expect(reloadForChunkError()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})

describe('isNewVersionDeployed', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  // 版本在模块加载时读取，按需设置环境变量后重新导入
  async function load(version: string, buildTime = '1000') {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', version)
    vi.stubEnv('NEXT_PUBLIC_BUILD_TIME', buildTime)
    vi.resetModules()
    return (await import('./chunk-error')).isNewVersionDeployed
  }

  function stubVersionResponse(body: unknown, ok = true) {
    const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('reports a newer deployed version', async () => {
    const isNewVersionDeployed = await load('abc')
    stubVersionResponse({ version: 'def', builtAt: 2000 })
    expect(await isNewVersionDeployed()).toBe(true)
  })

  it('ignores an older or undated version (rolling update hitting an old instance)', async () => {
    const isNewVersionDeployed = await load('abc')
    stubVersionResponse({ version: 'old', builtAt: 500 })
    expect(await isNewVersionDeployed()).toBe(false)
    stubVersionResponse({ version: 'older' })
    expect(await isNewVersionDeployed()).toBe(false)
  })

  it('treats the same version, missing versions and failures as not deployed', async () => {
    const isNewVersionDeployed = await load('abc')
    stubVersionResponse({ version: 'abc' })
    expect(await isNewVersionDeployed()).toBe(false)
    stubVersionResponse({})
    expect(await isNewVersionDeployed()).toBe(false)
    stubVersionResponse({ version: 'def', builtAt: 2000 }, false)
    expect(await isNewVersionDeployed()).toBe(false)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await isNewVersionDeployed()).toBe(false)
  })

  it('does not check when the page version is unknown (local development)', async () => {
    const isNewVersionDeployed = await load('')
    const fetchMock = stubVersionResponse({ version: 'def' })
    expect(await isNewVersionDeployed()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
