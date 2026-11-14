import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_ENABLE_TELEMETRY

describe('telemetry loader 开关控制', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    delete process.env.NEXT_PUBLIC_ENABLE_TELEMETRY
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (ORIGINAL_ENV === undefined)
      delete process.env.NEXT_PUBLIC_ENABLE_TELEMETRY
    else
      process.env.NEXT_PUBLIC_ENABLE_TELEMETRY = ORIGINAL_ENV
  })

  it('未配置或设为 true 时按空闲时机加载 ./client 并补报跳转面包屑', async () => {
    const startTelemetry = vi.fn()
    const recordNavigation = vi.fn()
    const captureEarlyError = vi.fn()
    vi.doMock('./client', () => ({
      startTelemetry,
      recordNavigation,
      captureEarlyError,
    }))

    const origIdle = window.requestIdleCallback
    // 走 setTimeout 分支以便 fake timers 精确推进
    // @ts-expect-error 测试分支覆盖
    window.requestIdleCallback = undefined

    try {
      const { isTelemetryEnabled, recordNavigationLazy, scheduleTelemetry } = await import('./loader')
      expect(isTelemetryEnabled()).toBe(true)

      scheduleTelemetry()
      recordNavigationLazy('/posts/1', 'push')
      expect(startTelemetry).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1600)
      expect(startTelemetry).toHaveBeenCalledTimes(1)
      expect(recordNavigation).toHaveBeenCalledWith('/posts/1', 'push')
    }
    finally {
      window.requestIdleCallback = origIdle
    }
  })

  it('设为 false 时 scheduleTelemetry 与 recordNavigationLazy 短路，绝不加载 ./client', async () => {
    process.env.NEXT_PUBLIC_ENABLE_TELEMETRY = 'false'

    let clientImported = false
    vi.doMock('./client', () => {
      clientImported = true
      return {
        startTelemetry: vi.fn(),
        recordNavigation: vi.fn(),
        captureEarlyError: vi.fn(),
      }
    })

    const addListenerSpy = vi.spyOn(window, 'addEventListener')
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    const { isTelemetryEnabled, recordNavigationLazy, scheduleTelemetry } = await import('./loader')
    expect(isTelemetryEnabled()).toBe(false)

    scheduleTelemetry()
    recordNavigationLazy('/posts/1', 'push')
    await vi.advanceTimersByTimeAsync(10000)

    expect(clientImported).toBe(false)
    expect(addListenerSpy).not.toHaveBeenCalled()
    expect(setTimeoutSpy).not.toHaveBeenCalled()
  })
})
