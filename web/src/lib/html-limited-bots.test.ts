import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types'
import React, { act, StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildHomeSnapshotKey,
  clearHomeSnapshot,
  fetchHomeSnapshotDedup,
  readFreshHomeSnapshot,
  writeHomeSnapshot,
} from '@/app/[locale]/(main)/blog-home-query'
import {
  clearHoverPrefetchCache,
  HoverPrefetchLink,
  resetHoverPrefetchCacheForTests,
} from '@/components/common/hover-prefetch-link'
import { nextConvexProgress, TopProgressBar } from '@/components/common/top-progress-bar'
import { MainRouteTransition, resolveLeafSkeletonKind } from '@/components/layout/client-route-skeleton'
import { HTML_LIMITED_BOTS_REGEX, isHtmlLimitedCrawler } from './html-limited-bots'
import {
  getNavigationTransitionSnapshot,
  notifyNavigationComplete,
  notifyNavigationStart,
  resetNavigationTransitionForTests,
  setCommittedNavigationLocation,
  shouldTrackNavigationTransition,
} from './navigation-transition'

let mockedPathname = '/'
let mockedSearch = ''
const prefetchSpy = vi.fn()

vi.mock('@/contexts/nav-context', () => ({
  useNav: () => ({ fullscreen: false }),
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => mockedPathname,
  useRouter: () => ({
    prefetch: prefetchSpy,
    push: vi.fn(),
    replace: vi.fn(),
  }),
  Link: ({ href, prefetch, unstable_dynamicOnHover, children, ...rest }: Record<string, unknown>) =>
    React.createElement(
      'a',
      {
        'href': String(href),
        'data-prefetch': String(prefetch),
        'data-dynamic-hover': String(unstable_dynamicOnHover),
        ...rest,
      },
      children as React.ReactNode,
    ),
}))

vi.mock('next-intl', () => ({
  useLocale: () => 'zh-CN',
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockedPathname,
  useSearchParams: () => new URLSearchParams(mockedSearch),
}))

describe('htmlLimitedBots crawler UA regex', () => {
  it('preserves all Next.js built-in crawlers, matches AI/search/CLI bots, avoids browser false positives, and runs in linear O(N) time without ReDoS', () => {
    const mustMatchBots = [
      // Next.js 内置爬虫代表
      'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'Twitterbot/1.0',
      'facebookexternalhit/1.1',
      'LinkedInBot/1.0',
      'Slackbot-LinkExpanding 1.0',
      'Discordbot/2.0',
      'WhatsApp/2.23.20.0',
      'Mediapartners-Google',
      'APIs-Google',
      'Google-InspectionTool/1.0',
      // 新增 AI / 搜索引擎 / 采集器 / CLI 工具
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; GoogleOther)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Google-Extended)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
      'Claude-SearchBot/1.0',
      'Claude-User/1.0',
      'Mozilla/5.0 (compatible; anthropic-ai)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
      'Perplexity-User/1.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
      'Applebot-Extended/1.0',
      'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko; compatible; Bytespider; spider-feedback@bytedance.com)',
      'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
      'Sogou web spider/4.0(+http://www.sogou.com/docs/help/webmasters.htm#07)',
      'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
      'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
      'Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)',
      'CCBot/2.0 (https://commoncrawl.org/faq/)',
      'Mozilla/5.0 (compatible; meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))',
      'Meta-ExternalFetcher/1.1',
      'FacebookBot/1.0',
      'cohere-ai/1.0',
      'Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US; rv:1.9.1.2) Gecko/20090729 Firefox/3.5.2 (.NET CLR 3.5.30729; Diffbot/0.1; +http://www.diffbot.com)',
      'Mozilla/5.0 (compatible; YouBot/1.0; +https://about.you.com/youbot/)',
      'curl/8.7.1',
      'Wget/1.21.4',
      'python-requests/2.32.3',
      'Scrapy/2.11.2 (+https://scrapy.org)',
      'python-httpx/0.27.0',
      'Go-http-client/2.0',
    ]

    for (const ua of mustMatchBots) {
      expect(HTML_LIMITED_BOTS_REGEX.test(ua), `expected crawler UA to match: ${ua}`).toBe(true)
      expect(isHtmlLimitedCrawler(ua)).toBe(true)
    }

    const normalBrowsers = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.81 Mobile Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50',
    ]

    for (const ua of normalBrowsers) {
      expect(HTML_LIMITED_BOTS_REGEX.test(ua), `expected human browser UA NOT to match: ${ua}`).toBe(false)
      expect(isHtmlLimitedCrawler(ua)).toBe(false)
    }

    // 防多项式回溯（ReDoS）回归验证：恶意构造的重复 "a-" 序列应在极短线性时间内返回 false
    const adversarialUa = 'a-'.repeat(15_000)
    const t0 = performance.now()
    expect(HTML_LIMITED_BOTS_REGEX.test(adversarialUa)).toBe(false)
    expect(isHtmlLimitedCrawler(adversarialUa)).toBe(false)
    expect(performance.now() - t0).toBeLessThan(25)
  })
})

describe('topProgressBar & navigation transition store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    mockedPathname = '/'
    mockedSearch = ''
    resetNavigationTransitionForTests()
  })

  afterEach(() => {
    resetNavigationTransitionForTests()
    vi.useRealTimers()
  })

  it('normalizes percent-encoding and search params, handles popstate traverse against committedLocation, and cancels slow transitions when clicking current route', () => {
    let p = 0.66
    for (let i = 0; i < 20; i++) {
      const next = nextConvexProgress(p)
      expect(next).toBeGreaterThanOrEqual(p)
      expect(next).toBeLessThanOrEqual(0.92)
      p = next
    }
    expect(nextConvexProgress(0.92)).toBe(0.92)

    const loc = { origin: 'https://blog.sfkm.me', pathname: '/music', search: '?id=1&start=10' }
    expect(shouldTrackNavigationTransition('/music?id=1&start=11', 'replace', loc)).toBeNull()
    expect(shouldTrackNavigationTransition('#lyrics', 'push', loc)).toBeNull()
    expect(shouldTrackNavigationTransition('/music?id=1&start=10#lyrics', 'push', loc)).toBeNull()
    expect(shouldTrackNavigationTransition('/p/hello-world', 'push', loc)).toEqual({
      pathname: '/p/hello-world',
      search: '',
    })

    // %20 vs +、大小写百分号编码以及含保留分隔符转义（如 %23）在同路径下应安全归一，不产生路径截断或假阳性卡死
    const encodedLoc = { origin: 'https://blog.sfkm.me', pathname: '/p/%e4%b8%ad%e6%96%87', search: '?query=hello+world' }
    expect(shouldTrackNavigationTransition('/p/中文?query=hello%20world', 'push', encodedLoc)).toBeNull()
    const sharpLoc = { origin: 'https://blog.sfkm.me', pathname: '/p/c%23-guide', search: '' }
    expect(shouldTrackNavigationTransition('#toc', 'push', sharpLoc)).toBeNull()

    // popstate (traverse)：浏览器已提前将 window.location 切至目标历史项，基于 committedLocation 仍能正确触发过渡
    setCommittedNavigationLocation('/p/post-1', '', 'http://localhost:3000')
    window.history.replaceState(null, '', 'http://localhost:3000/a')
    notifyNavigationStart('http://localhost:3000/a', 'traverse')
    expect(getNavigationTransitionSnapshot().active).toBe(true)
    expect(getNavigationTransitionSnapshot().targetPath).toBe('/a')

    // 慢导航途中用户反悔点回当前已提交路由（/p/post-1）时立即取消挂起状态，绝不死锁 12s
    notifyNavigationStart('http://localhost:3000/p/post-1#top', 'push')
    expect(getNavigationTransitionSnapshot().active).toBe(false)
  })

  it('renders GPU-composited progress bar under StrictMode without timer explosion and settles even on 308 redirect back to same route', async () => {
    window.history.replaceState(null, '', 'http://localhost:3000/p/canonical-slug')
    mockedPathname = '/p/canonical-slug'
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(React.createElement(StrictMode, null, React.createElement(TopProgressBar)))
      })
      expect(container.querySelector('[data-top-progress]')).toBeNull()

      // 模拟点击 /p/123，服务端 308 重定向回同一个 /p/canonical-slug（routeKey 未变，但 React Transition 提交完成）
      await act(async () => {
        React.startTransition(() => {
          notifyNavigationStart('/p/123', 'push', { fromRouterTransition: true })
        })
      })
      expect(getNavigationTransitionSnapshot().active).toBe(false)

      // 常规慢跳转进度推进与提交收尾（StrictMode 下无指数级定时器衍生）
      await act(async () => {
        notifyNavigationStart('/p/target-slug', 'push')
      })
      const wrapper = container.querySelector('[data-top-progress]') as HTMLElement | null
      expect(wrapper).not.toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(1600)
      })
      const bar = wrapper!.firstElementChild as HTMLElement
      expect(bar.style.transform).toMatch(/^scaleX\(0\.[789]/)

      mockedPathname = '/p/target-slug'
      window.history.replaceState(null, '', 'http://localhost:3000/p/target-slug')
      await act(async () => {
        root.render(React.createElement(StrictMode, null, React.createElement(TopProgressBar)))
      })
      expect(getNavigationTransitionSnapshot().active).toBe(false)
      expect((container.querySelector('[data-top-progress]')?.firstElementChild as HTMLElement)?.style.transform).toBe('scaleX(1)')

      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      expect(container.querySelector('[data-top-progress]')).toBeNull()
    }
    finally {
      notifyNavigationComplete()
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  })
})

describe('hoverPrefetchLink hover-intent, PrefetchKind.FULL & invalidation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    prefetchSpy.mockReset()
    resetHoverPrefetchCacheForTests()
  })

  afterEach(() => {
    resetHoverPrefetchCacheForTests()
    vi.useRealTimers()
  })

  it('disables viewport prefetch, passes PrefetchKind.FULL after 80ms hover/focus, and re-prefetches after cache invalidation', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(React.createElement(HoverPrefetchLink, { href: '/p/hello-world' }, 'Hello'))
      })
      const anchor = container.querySelector('a')!
      expect(anchor.getAttribute('data-prefetch')).toBe('false')
      expect(anchor.getAttribute('data-dynamic-hover')).toBe('false')

      const Ev = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent
      const enterType = typeof PointerEvent !== 'undefined' ? 'pointerover' : 'mouseover'
      const leaveType = typeof PointerEvent !== 'undefined' ? 'pointerout' : 'mouseout'

      await act(async () => {
        anchor.dispatchEvent(new Ev(enterType, { bubbles: true, relatedTarget: document.body }))
        vi.advanceTimersByTime(40)
        anchor.dispatchEvent(new Ev(leaveType, { bubbles: true, relatedTarget: document.body }))
        vi.advanceTimersByTime(100)
      })
      expect(prefetchSpy).not.toHaveBeenCalled()

      await act(async () => {
        anchor.dispatchEvent(new Ev(enterType, { bubbles: true, relatedTarget: document.body }))
        vi.advanceTimersByTime(90)
      })
      expect(prefetchSpy).toHaveBeenCalledTimes(1)
      expect(prefetchSpy).toHaveBeenCalledWith('/p/hello-world', expect.objectContaining({
        kind: PrefetchKind.FULL,
        onInvalidate: expect.any(Function),
      }))

      // 60s 窗口内重复悬停去重
      await act(async () => {
        anchor.dispatchEvent(new Ev(leaveType, { bubbles: true, relatedTarget: document.body }))
        anchor.dispatchEvent(new Ev(enterType, { bubbles: true, relatedTarget: document.body }))
        vi.advanceTimersByTime(100)
      })
      expect(prefetchSpy).toHaveBeenCalledTimes(1)

      // 后台修改公开内容触发 clearHoverPrefetchCache() 后允许重新预取最新正文
      clearHoverPrefetchCache()
      await act(async () => {
        anchor.dispatchEvent(new Ev(leaveType, { bubbles: true, relatedTarget: document.body }))
        anchor.dispatchEvent(new Ev(enterType, { bubbles: true, relatedTarget: document.body }))
        vi.advanceTimersByTime(100)
      })
      expect(prefetchSpy).toHaveBeenCalledTimes(2)
    }
    finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  })
})

describe('client-only leaf route skeleton & home snapshot LRU', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    resetNavigationTransitionForTests()
    clearHomeSnapshot()
  })

  afterEach(() => {
    resetNavigationTransitionForTests()
    clearHomeSnapshot()
    vi.useRealTimers()
  })

  it('matches only /p/:id and /page/:id leaf routes across locales and excludes list or share-image routes', () => {
    expect(resolveLeafSkeletonKind('/p/hello-world')).toBe('post')
    expect(resolveLeafSkeletonKind('/en/p/hello-world')).toBe('post')
    expect(resolveLeafSkeletonKind('/zh-hk/p/42')).toBe('post')
    expect(resolveLeafSkeletonKind('/page/about')).toBe('page')
    expect(resolveLeafSkeletonKind('/ja/page/about')).toBe('page')

    expect(resolveLeafSkeletonKind(null)).toBeNull()
    expect(resolveLeafSkeletonKind('/')).toBeNull()
    expect(resolveLeafSkeletonKind('/a')).toBeNull()
    expect(resolveLeafSkeletonKind('/en/a')).toBeNull()
    expect(resolveLeafSkeletonKind('/c/tech')).toBeNull()
    expect(resolveLeafSkeletonKind('/p/hello-world/share-image')).toBeNull()
  })

  it('preserves exact child DOM identity & React state across transitions, skips <60ms cache hits, and ignores same-post query jumps', async () => {
    function StatefulArchiveChild() {
      const [count, setCount] = useState(0)
      return React.createElement(
        'button',
        { id: 'archive-stateful', type: 'button', onClick: () => setCount(c => c + 1) },
        `count:${count}`,
      )
    }

    setCommittedNavigationLocation('/a', '', 'http://localhost:3000')
    window.history.replaceState(null, '', 'http://localhost:3000/a')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(React.createElement(MainRouteTransition, null, React.createElement(StatefulArchiveChild)))
      })
      const initialBtn = container.querySelector('#archive-stateful') as HTMLButtonElement
      expect(initialBtn).not.toBeNull()
      expect(container.innerHTML).not.toContain('aria-busy')

      await act(async () => {
        initialBtn.click()
      })
      expect(initialBtn.textContent).toBe('count:1')

      // 命中缓存的快速跳转（20ms < 60ms 延迟门槛）不会闪出骨架帧
      await act(async () => {
        notifyNavigationStart('/p/prefetched-post', 'push')
      })
      await act(async () => {
        vi.advanceTimersByTime(20)
        notifyNavigationComplete()
        vi.advanceTimersByTime(100)
      })
      expect(container.querySelector('[data-client-route-skeleton]')).toBeNull()
      expect(container.querySelector('#archive-stateful')).toBe(initialBtn)
      expect(initialBtn.textContent).toBe('count:1')

      // 未预取冷跳转超过 60ms 显示叶子骨架，且原节点 DOM 引用与内部 state 全程不卸载重挂
      await act(async () => {
        notifyNavigationStart('/p/cold-post', 'push')
      })
      await act(async () => {
        vi.advanceTimersByTime(70)
      })
      expect(container.querySelector('[data-client-route-skeleton="post"]')).not.toBeNull()
      expect(container.querySelector('#archive-stateful')).toBe(initialBtn)

      // 骨架已展示期间紧接着点击第二个冷页面（seq = 1 -> 2），骨架无缝切换、不出现 60ms 旧页闪回空白窗
      await act(async () => {
        notifyNavigationStart('/page/about', 'push')
      })
      expect(container.querySelector('[data-client-route-skeleton="page"]')).not.toBeNull()
      expect(container.querySelector('#archive-stateful')).toBe(initialBtn)

      setCommittedNavigationLocation('/page/about', '', 'http://localhost:3000')
      window.history.replaceState(null, '', 'http://localhost:3000/page/about')
      await act(async () => {
        notifyNavigationComplete()
      })
      expect(container.querySelector('[data-client-route-skeleton]')).toBeNull()
      expect(container.querySelector('#archive-stateful')).toBe(initialBtn)
      expect(initialBtn.textContent).toBe('count:1')

      // 同一独立页内跳转 ?comment= 深链不触发整页详情骨架遮盖正文
      await act(async () => {
        notifyNavigationStart('/page/about?comment=99', 'push')
        vi.advanceTimersByTime(100)
      })
      expect(container.querySelector('[data-client-route-skeleton]')).toBeNull()
    }
    finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  })

  it('maintains bounded multi-slot home snapshots and deduplicates concurrent heat prewarm + click fetches', async () => {
    const page2Key = buildHomeSnapshotKey({ locale: 'zh-CN', size: 9, queryKey: '2||||created_at' })
    const heatKey = buildHomeSnapshotKey({ locale: 'zh-CN', size: 9, queryKey: '1||||heat' })
    writeHomeSnapshot({ cacheKey: page2Key, key: '2||||created_at', posts: [], total: 20, pinned: [] })

    let calls = 0
    const loader = async () => {
      calls += 1
      await new Promise(resolve => setTimeout(resolve, 50))
      return { cacheKey: heatKey, key: '1||||heat', posts: [], total: 10, pinned: [] }
    }

    const p1 = fetchHomeSnapshotDedup(heatKey, loader)
    const p2 = fetchHomeSnapshotDedup(heatKey, loader)
    await act(async () => {
      vi.advanceTimersByTime(60)
    })
    await Promise.all([p1, p2])

    expect(calls).toBe(1)
    // 预热最热第 1 页不会冲掉已保存的第 2 页快照
    expect(readFreshHomeSnapshot(page2Key)).not.toBeNull()
    expect(readFreshHomeSnapshot(heatKey)).not.toBeNull()
  })
})
