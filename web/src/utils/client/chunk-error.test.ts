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
    // 被包装后的错误沿 cause 查找
    expect(isChunkLoadError(new Error('render failed', { cause: turbopack }))).toBe(true)
  })

  it('ignores other errors', () => {
    expect(isChunkLoadError(new Error('Network Error'))).toBe(false)
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
