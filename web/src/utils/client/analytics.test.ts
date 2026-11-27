import type { NextWebVitalsMetric } from 'next/app'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  matchesVisitPrefix,
  resetVisitReporterForTests,
  VisitReporter,
} from '@/components/common/visit-reporter'
import {
  configureWebVitalsSampling,
  DEFAULT_DEV_WEB_VITALS_SAMPLE_RATE,
  DEFAULT_PROD_WEB_VITALS_SAMPLE_RATE,
  reportWebVitalMetric,
  resetWebVitalsReporterForTests,
  resolveWebVitalsSampleRate,
  shouldSampleWebVitalsSession,
} from '@/components/common/web-vitals-reporter'
import {
  DEFAULT_BATCH_SIZE_THRESHOLD,
  DEFAULT_FLUSH_INTERVAL_MS,
  EVENT_ENDPOINT,
  flushAnalyticsEvents,
  isAnalyticsRateLimited,
  parseRetryAfterMs,
  teardownAnalytics,
  trackEngagement,
  trackFileDownload,
  trackOutboundLink,
  trackPageview,
  trackWebVital,
  truncateEventUrl,
} from './analytics'

let mockedPathname = '/'
let mockedSearch = ''

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => mockedPathname,
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockedSearch),
}))

vi.mock('next/web-vitals', () => ({
  useReportWebVitals: vi.fn(),
}))

function okResponse() {
  return new Response(JSON.stringify({ status: 200 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function rateLimitResponse(retryAfter?: string) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (retryAfter !== undefined)
    headers.set('Retry-After', retryAfter)
  return new Response(JSON.stringify({ status: 429 }), {
    status: 429,
    headers,
  })
}

function parseBatchBody(call: unknown[]) {
  const init = call[1] as RequestInit | undefined
  return JSON.parse(String(init?.body ?? '{}'))
}

describe('analytics EventBatcher & telemetry pipeline', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    mockedPathname = '/'
    mockedSearch = ''
    window.history.replaceState(null, '', 'http://localhost:3000/')
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    Object.defineProperty(navigator, 'doNotTrack', {
      configurable: true,
      value: '0',
    })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    teardownAnalytics()
    resetWebVitalsReporterForTests()
    resetVisitReporterForTests()
  })

  afterEach(() => {
    teardownAnalytics()
    resetWebVitalsReporterForTests()
    resetVisitReporterForTests()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('queues non-critical events without immediate fetch and flushes on timer via requestIdleCallback', async () => {
    const idleCallbacks: Array<IdleRequestCallback> = []
    vi.stubGlobal('requestIdleCallback', vi.fn((cb: IdleRequestCallback) => {
      idleCallbacks.push(cb)
      return idleCallbacks.length
    }))
    vi.stubGlobal('cancelIdleCallback', vi.fn())

    trackWebVital({ name: 'FCP', value: 420.1234, rating: 'good', url: 'http://localhost:3000/p/1' })
    trackWebVital({ name: 'LCP', value: 1180.5, rating: 'good', url: 'http://localhost:3000/p/1' })
    trackOutboundLink('https://github.com/snowykami', 'http://localhost:3000/p/1')
    trackFileDownload('http://localhost:3000/files/spec.pdf', 'http://localhost:3000/p/1')

    expect(fetchMock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS)
    expect(idleCallbacks).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => {
      idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 12 })
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(EVENT_ENDPOINT)
    const payload = parseBatchBody(fetchMock.mock.calls[0])
    expect(payload.events).toHaveLength(4)
    expect(payload.events.map((e: { n: string }) => e.n)).toEqual([
      'Web Vital',
      'Web Vital',
      'Outbound Link: Click',
      'File Download',
    ])
    expect(payload.events[0].p).toEqual({ metric: 'FCP', value: 420.123, rating: 'good' })
  })

  it('flushes immediately when reaching batch size threshold and cancels pending timer', async () => {
    for (let i = 0; i < DEFAULT_BATCH_SIZE_THRESHOLD; i++) {
      trackOutboundLink(`https://example.com/${i}`, 'http://localhost:3000/')
      if (i < DEFAULT_BATCH_SIZE_THRESHOLD - 1)
        expect(fetchMock).not.toHaveBeenCalled()
    }

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const payload = parseBatchBody(fetchMock.mock.calls[0])
    expect(payload.events).toHaveLength(DEFAULT_BATCH_SIZE_THRESHOLD)

    // 阈值触发后原定时器已清理，后续静置不应空转重发
    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS * 3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('coalesces multiple engagement events per URL by summing engaged_ms and taking max scroll_depth', async () => {
    trackEngagement({ engagedMs: 3000, scrollDepth: 35, url: 'http://localhost:3000/p/post-a' })
    trackEngagement({ engagedMs: 4500, scrollDepth: 88, url: 'http://localhost:3000/p/post-a' })
    trackEngagement({ engagedMs: 1500, scrollDepth: 60, url: 'http://localhost:3000/p/post-a' })
    trackEngagement({ engagedMs: 2200, scrollDepth: 50, url: 'http://localhost:3000/p/post-b' })

    expect(fetchMock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(DEFAULT_FLUSH_INTERVAL_MS)
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const payload = parseBatchBody(fetchMock.mock.calls[0])
    expect(payload.events).toEqual([
      {
        n: 'engagement',
        u: 'http://localhost:3000/p/post-a',
        d: 'localhost',
        e: 9000,
        sd: 88,
      },
      {
        n: 'engagement',
        u: 'http://localhost:3000/p/post-b',
        d: 'localhost',
        e: 2200,
        sd: 50,
      },
    ])
  })

  it('sends pageview immediately, snapshots prior page engagement, and does not count blurred background time', async () => {
    await trackPageview({
      url: 'http://localhost:3000/p/first',
      referrer: 'https://www.google.com/',
      targetType: 'post',
      targetId: 10,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const firstPv = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(firstPv.n).toBe('pageview')
    expect(firstPv.u).toBe('http://localhost:3000/p/first')
    expect(firstPv.r).toBe('https://www.google.com/')
    expect(firstPv.p.target_type).toBe('post')
    expect(firstPv.p.target_id).toBe(10)

    // 活跃阅读 4 秒后窗口失焦（blur），即使期间触发 visibilitychange=visible 也不应恢复计时
    vi.advanceTimersByTime(4000)
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(60_000)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(60_000)
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(1000)

    await trackPageview({
      url: 'http://localhost:3000/p/second',
      referrer: 'http://localhost:3000/p/first',
      targetType: 'post',
      targetId: 11,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).n).toBe('pageview')

    await flushAnalyticsEvents()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const flushed = parseBatchBody(fetchMock.mock.calls[2])
    expect(flushed.events).toHaveLength(1)
    expect(flushed.events[0]).toMatchObject({
      n: 'engagement',
      u: 'http://localhost:3000/p/first',
      e: 5000,
    })
  })

  it('filters poison-pill Web Vitals (>600s, NaN, Infinity, invalid rating) and non-http links before queueing', async () => {
    trackWebVital({ name: 'LCP', value: 720_000, rating: 'poor', url: 'http://localhost:3000/p/1' })
    trackWebVital({ name: 'LCP', value: Number.NaN, rating: 'good', url: 'http://localhost:3000/p/1' })
    trackWebVital({ name: 'LCP', value: Number.POSITIVE_INFINITY, rating: 'good', url: 'http://localhost:3000/p/1' })
    trackWebVital({ name: 'FID', value: 50, rating: 'good', url: 'http://localhost:3000/p/1' })
    trackOutboundLink('javascript:alert(1)', 'http://localhost:3000/p/1')
    trackWebVital({ name: 'FCP', value: 510, rating: 'good', url: 'http://localhost:3000/p/1' })

    await flushAnalyticsEvents()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const payload = parseBatchBody(fetchMock.mock.calls[0])
    expect(payload.events).toHaveLength(1)
    expect(payload.events[0].p).toEqual({ metric: 'FCP', value: 510, rating: 'good' })

    // 校验中文百分号编码 URL 截断不会留下半截 %XX 或残缺 UTF-8 字节序列
    const encodedChinese = `https://blog.example.com/p/${encodeURIComponent('中文标题测试'.repeat(40))}`
    for (const limit of [40, 41, 42, 43, 44, 45]) {
      const truncated = truncateEventUrl(encodedChinese, limit)
      expect(truncated.length).toBeLessThanOrEqual(limit)
      expect(() => decodeURIComponent(new URL(truncated).pathname)).not.toThrow()
    }
  })

  it('enters circuit-breaker backoff on 429, clears backlog queue, and resumes after Retry-After', async () => {
    expect(parseRetryAfterMs('45')).toBe(45_000)

    fetchMock.mockResolvedValueOnce(rateLimitResponse('30'))

    trackWebVital({ name: 'LCP', value: 1500, rating: 'good', url: 'http://localhost:3000/' })
    await flushAnalyticsEvents()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(isAnalyticsRateLimited()).toBe(true)

    // 熔断退避窗口内入队的非关键事件全部静默丢弃，不会发起任何请求
    trackWebVital({ name: 'CLS', value: 0.05, rating: 'good', url: 'http://localhost:3000/' })
    trackEngagement({ engagedMs: 5000, scrollDepth: 80, url: 'http://localhost:3000/' })
    trackOutboundLink('https://example.org', 'http://localhost:3000/')
    vi.advanceTimersByTime(20_000)
    await flushAnalyticsEvents()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 超过 30 秒冷却期后恢复正常缓冲上报
    vi.advanceTimersByTime(11_000)
    expect(isAnalyticsRateLimited()).toBe(false)

    trackWebVital({ name: 'INP', value: 96, rating: 'good', url: 'http://localhost:3000/' })
    await flushAnalyticsEvents()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(parseBatchBody(fetchMock.mock.calls[1]).events).toHaveLength(1)
  })

  it('flushes remaining queue via navigator.sendBeacon on visibilitychange hidden and pagehide with keepalive fallback', async () => {
    const sendBeaconMock = vi.fn<(url: string | URL, data?: BodyInit | null) => boolean>(() => true)
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeaconMock,
    })

    trackWebVital({ name: 'TTFB', value: 95, rating: 'good', url: 'http://localhost:3000/' })
    trackWebVital({ name: 'FCP', value: 380, rating: 'good', url: 'http://localhost:3000/' })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    expect(sendBeaconMock.mock.calls[0][0]).toBe(EVENT_ENDPOINT)
    const beaconPayload = JSON.parse(String(sendBeaconMock.mock.calls[0][1]))
    expect(beaconPayload.events).toHaveLength(2)
    expect(fetchMock).not.toHaveBeenCalled()

    // 紧随其后的 pagehide 因队列已刷空，不会重复发送
    window.dispatchEvent(new Event('pagehide'))
    expect(sendBeaconMock).toHaveBeenCalledTimes(1)

    // 当 sendBeacon 返回 false（如队列满）时自动回退到 keepalive fetch
    sendBeaconMock.mockReturnValueOnce(false)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    trackOutboundLink('https://example.com/fallback', 'http://localhost:3000/')
    window.dispatchEvent(new Event('pagehide'))

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect((fetchMock.mock.calls[0][1] as RequestInit).keepalive).toBe(true)
  })
})

describe('webVitalsReporter session sampling', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    teardownAnalytics()
    resetWebVitalsReporterForTests()
  })

  afterEach(() => {
    teardownAnalytics()
    resetWebVitalsReporterForTests()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('skips by default in development, samples 20% sessions in production, and drops out-of-range metrics', async () => {
    expect(resolveWebVitalsSampleRate({ nodeEnv: 'development', rawRate: '' })).toBe(DEFAULT_DEV_WEB_VITALS_SAMPLE_RATE)
    expect(resolveWebVitalsSampleRate({ nodeEnv: 'production', rawRate: '' })).toBe(DEFAULT_PROD_WEB_VITALS_SAMPLE_RATE)
    expect(resolveWebVitalsSampleRate({ nodeEnv: 'development', rawRate: '0.5' })).toBe(0.5)

    // 未命中的会话（0.65 >= 0.2）整个会话不入队
    expect(shouldSampleWebVitalsSession({ sampleRate: 0.2, random: () => 0.65 })).toBe(false)
    configureWebVitalsSampling(0.2)
    reportWebVitalMetric({ id: 'v1', name: 'LCP', value: 1200, rating: 'good' } as unknown as NextWebVitalsMetric)
    await flushAnalyticsEvents()
    expect(fetchMock).not.toHaveBeenCalled()

    // 命中的会话（0.12 < 0.2）同一会话内合法指标合并为单次批量上报，越界指标与相同 metric.id 自动忽略
    resetWebVitalsReporterForTests()
    expect(shouldSampleWebVitalsSession({ sampleRate: 0.2, random: () => 0.12 })).toBe(true)
    configureWebVitalsSampling(0.2)
    reportWebVitalMetric({ id: 'm-fcp', name: 'FCP', value: 410, rating: 'good' } as unknown as NextWebVitalsMetric)
    reportWebVitalMetric({ id: 'm-fcp', name: 'FCP', value: 410, rating: 'good' } as unknown as NextWebVitalsMetric)
    reportWebVitalMetric({ id: 'm-lcp', name: 'LCP', value: 1320, rating: 'good' } as unknown as NextWebVitalsMetric)
    reportWebVitalMetric({ id: 'm-cls', name: 'CLS', value: 0.02, rating: 'good' } as unknown as NextWebVitalsMetric)
    reportWebVitalMetric({ id: 'm-bg', name: 'LCP', value: 900_000, rating: 'poor' } as unknown as NextWebVitalsMetric)

    expect(fetchMock).not.toHaveBeenCalled()
    await flushAnalyticsEvents()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const payload = parseBatchBody(fetchMock.mock.calls[0])
    expect(payload.events).toHaveLength(3)
  })
})

describe('visitReporter prefix matching & duplicate pageview prevention', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    mockedPathname = '/'
    mockedSearch = ''
    window.history.replaceState(null, '', 'http://localhost:3000/')
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    teardownAnalytics()
    resetVisitReporterForTests()
  })

  afterEach(() => {
    teardownAnalytics()
    resetVisitReporterForTests()
    vi.unstubAllGlobals()
  })

  it('matches route prefixes accurately without false positives on sibling paths', () => {
    expect(matchesVisitPrefix('/p/123', '/p/')).toBe(true)
    expect(matchesVisitPrefix('/portfolio', '/p/')).toBe(false)
    expect(matchesVisitPrefix('/music', '/music')).toBe(true)
    expect(matchesVisitPrefix('/music/track', '/music')).toBe(true)
    expect(matchesVisitPrefix('/musician', '/music')).toBe(false)
    expect(matchesVisitPrefix('/random', '/random')).toBe(true)
  })

  it('prevents double pageview on /music, preserves /random referrer, tracks home query filters, and resets on unmount', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      // 1. 访问 /music 时即使 MainShell 与 MusicPlayerPage 同时挂载且播放进度秒级更新 search，也只上报 1 次 pageview
      mockedPathname = '/music'
      mockedSearch = 'id=1&start=5'
      window.history.replaceState(null, '', 'http://localhost:3000/music?id=1&start=5')
      await act(async () => {
        root.render(
          React.createElement(
            React.StrictMode,
            null,
            React.createElement(VisitReporter, { key: 'main-shell', skipPrefixes: ['/p/', '/page/', '/music'], transitPrefixes: ['/random'] }),
            React.createElement(VisitReporter, { key: 'music-page', allowPrefixes: ['/music'], ignoreSearch: true }),
          ),
        )
      })
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      mockedSearch = 'id=1&start=6'
      window.history.replaceState(null, '', 'http://localhost:3000/music?id=1&start=6')
      await act(async () => {
        root.render(
          React.createElement(
            React.Fragment,
            null,
            React.createElement(VisitReporter, { key: 'main-shell', skipPrefixes: ['/p/', '/page/', '/music'], transitPrefixes: ['/random'] }),
            React.createElement(VisitReporter, { key: 'music-page', allowPrefixes: ['/music'], ignoreSearch: true }),
          ),
        )
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // 2. 经 /random 中转跳往 /p/42：/random 本身不发包，但 /p/42 的 referrer 正确记为 /random（保留 SourceRandom）
      mockedPathname = '/random'
      mockedSearch = ''
      window.history.replaceState(null, '', 'http://localhost:3000/random')
      await act(async () => {
        root.render(
          React.createElement(VisitReporter, { key: 'main-shell', skipPrefixes: ['/p/', '/page/', '/music'], transitPrefixes: ['/random'] }),
        )
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)

      mockedPathname = '/p/42'
      window.history.replaceState(null, '', 'http://localhost:3000/p/42')
      await act(async () => {
        root.render(
          React.createElement(
            React.Fragment,
            null,
            React.createElement(VisitReporter, { key: 'main-shell', skipPrefixes: ['/p/', '/page/', '/music'], transitPrefixes: ['/random'] }),
            React.createElement(VisitReporter, { key: 'post-42', targetType: 'post', targetId: 42 }),
          ),
        )
      })
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2)
      })
      const postPv = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
      expect(postPv.u).toBe('http://localhost:3000/p/42')
      expect(postPv.r).toBe('http://localhost:3000/random')
      expect(postPv.p.target_id).toBe(42)

      // 3. 离开前台路由（如进入 /auth/login 或 /console）卸载 VisitReporter 后再次回到同一篇 /p/42，仍能正常重新上报以触发登录归因
      await act(async () => {
        root.render(null)
      })
      await Promise.resolve()

      await act(async () => {
        root.render(React.createElement(VisitReporter, { key: 'post-42-return', targetType: 'post', targetId: 42 }))
      })
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(3)
      })

      // 4. 首页查询参数筛选跳转（/ -> /?label=go）正常触发上报并更新 referrer
      mockedPathname = '/'
      mockedSearch = ''
      window.history.replaceState(null, '', 'http://localhost:3000/')
      await act(async () => {
        root.render(
          React.createElement(VisitReporter, { key: 'main-shell', skipPrefixes: ['/p/', '/page/', '/music'], transitPrefixes: ['/random'] }),
        )
      })
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(4)
      })

      mockedSearch = 'label=go'
      window.history.replaceState(null, '', 'http://localhost:3000/?label=go')
      await act(async () => {
        root.render(
          React.createElement(VisitReporter, { key: 'main-shell', skipPrefixes: ['/p/', '/page/', '/music'], transitPrefixes: ['/random'] }),
        )
      })
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(5)
      })
      const filterPv = JSON.parse(String((fetchMock.mock.calls[4][1] as RequestInit).body))
      expect(filterPv.u).toBe('http://localhost:3000/?label=go')
      expect(filterPv.r).toBe('http://localhost:3000/')

      // 5. 从带参数的首页 /?label=go 跨路由跳往归档页 /a 时，不会因状态滞后拼出幽灵 /a?label=go 或双发 pageview；
      //    且对含 %20 编码的首屏查询串（URLSearchParams 会转为 +）不会重复上报
      mockedPathname = '/a'
      mockedSearch = ''
      window.history.replaceState(null, '', 'http://localhost:3000/a')
      await act(async () => {
        root.render(
          React.createElement(VisitReporter, { key: 'main-shell', skipPrefixes: ['/p/', '/page/', '/music'], transitPrefixes: ['/random'] }),
        )
      })
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(6)
      })
      const archivePv = JSON.parse(String((fetchMock.mock.calls[5][1] as RequestInit).body))
      expect(archivePv.u).toBe('http://localhost:3000/a')
      expect(archivePv.r).toBe('http://localhost:3000/?label=go')

      mockedPathname = '/'
      mockedSearch = 'query=go+lang'
      window.history.replaceState(null, '', 'http://localhost:3000/?query=go%20lang')
      await act(async () => {
        root.render(
          React.createElement(VisitReporter, { key: 'main-shell', skipPrefixes: ['/p/', '/page/', '/music'], transitPrefixes: ['/random'] }),
        )
      })
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(7)
      })
      const searchPv = JSON.parse(String((fetchMock.mock.calls[6][1] as RequestInit).body))
      expect(searchPv.u).toBe('http://localhost:3000/?query=go%20lang')
    }
    finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  })
})
