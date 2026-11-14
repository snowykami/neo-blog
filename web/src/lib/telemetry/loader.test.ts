import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_ENABLE_TELEMETRY
const ORIGINAL_RUNTIME_ENV = process.env.ENABLE_TELEMETRY

describe('telemetry loader 开关控制', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    delete process.env.ENABLE_TELEMETRY
    delete process.env.NEXT_PUBLIC_ENABLE_TELEMETRY
    if (typeof document !== 'undefined')
      document.documentElement.removeAttribute('data-telemetry')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (ORIGINAL_RUNTIME_ENV === undefined)
      delete process.env.ENABLE_TELEMETRY
    else
      process.env.ENABLE_TELEMETRY = ORIGINAL_RUNTIME_ENV
    if (ORIGINAL_ENV === undefined)
      delete process.env.NEXT_PUBLIC_ENABLE_TELEMETRY
    else
      process.env.NEXT_PUBLIC_ENABLE_TELEMETRY = ORIGINAL_ENV
    if (typeof document !== 'undefined')
      document.documentElement.removeAttribute('data-telemetry')
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

  it('dom data-telemetry="false" 时返回 false 并短路 ./client 加载', async () => {
    document.documentElement.setAttribute('data-telemetry', 'false')

    let clientImported = false
    vi.doMock('./client', () => {
      clientImported = true
      return {
        startTelemetry: vi.fn(),
        recordNavigation: vi.fn(),
      }
    })

    const addListenerSpy = vi.spyOn(window, 'addEventListener')
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    const { isTelemetryEnabled, recordNavigationLazy, scheduleTelemetry } = await import('./loader')

    expect(isTelemetryEnabled()).toBe(false)
    scheduleTelemetry()
    recordNavigationLazy('/p/demo', 'push')
    await vi.runAllTimersAsync()

    expect(clientImported).toBe(false)
    expect(addListenerSpy).not.toHaveBeenCalled()
    expect(setTimeoutSpy).not.toHaveBeenCalled()
  })

  it('无 DOM 属性且 ENABLE_TELEMETRY="false" 时返回 false 并短路 ./client 加载', async () => {
    process.env.ENABLE_TELEMETRY = 'false'

    let clientImported = false
    vi.doMock('./client', () => {
      clientImported = true
      return {
        startTelemetry: vi.fn(),
        recordNavigation: vi.fn(),
      }
    })

    const addListenerSpy = vi.spyOn(window, 'addEventListener')
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    const { isTelemetryEnabled, recordNavigationLazy, scheduleTelemetry } = await import('./loader')

    expect(isTelemetryEnabled()).toBe(false)
    scheduleTelemetry()
    recordNavigationLazy('/p/runtime-off', 'push')
    await vi.runAllTimersAsync()

    expect(clientImported).toBe(false)
    expect(addListenerSpy).not.toHaveBeenCalled()
    expect(setTimeoutSpy).not.toHaveBeenCalled()
  })

  it('enable_telemetry="false" 时服务端 reportServerError 直接短路返回且不上报', async () => {
    process.env.ENABLE_TELEMETRY = 'false'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { reportServerError } = await import('./server')
    await reportServerError(
      new Error('ssr boom'),
      { path: '/test', method: 'GET', headers: {} },
      { routerKind: 'App Router', routePath: '/test', routeType: 'render', revalidateReason: undefined },
    )

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
