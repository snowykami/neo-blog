import type { SiteInfo } from '@/utils/common/siteinfo'
import { NextIntlClientProvider } from 'next-intl'
import * as React from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import zhMessages from '@/locales/zh.json'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ref, ...props }: React.ComponentProps<'a'>) =>
    React.createElement('a', { ...props, href: String(href), ref }, children),
  usePathname: () => '/',
}))

const testSiteInfo: SiteInfo = {
  ...fallbackSiteInfo,
  metadata: { ...fallbackSiteInfo.metadata, name: 'Snowykami\'s Blog' },
  island: {
    ...fallbackSiteInfo.island!,
    enabled: true,
    music: false,
    network: false,
    greeting: false,
    holiday: false,
  },
}

describe('topbarIsland 站名与胶囊互斥渲染', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('在 React Activity 隐藏期间状态切换并重新可见后，站名与胶囊不会同时残留并排显示', async () => {
    // happy-dom 的 Web Animations cancel() 会抛未捕获的 AbortError，测试中走 motion 的 JS 动画驱动
    const origAnimate = Element.prototype.animate
    // @ts-expect-error 测试环境屏蔽不完整的 WAAPI
    delete Element.prototype.animate

    vi.resetModules()
    const [{ SiteInfoProvider }, store, { TopbarIsland }] = await Promise.all([
      import('@/contexts/site-info-context'),
      import('@/contexts/topbar-island'),
      import('./topbar-island'),
    ])

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const renderWithMode = (mode: 'visible' | 'hidden') => {
      flushSync(() => {
        root.render(
          React.createElement(React.Activity, {
            mode,
            children: React.createElement(NextIntlClientProvider, {
              locale: 'zh',
              messages: zhMessages,
              children: React.createElement(SiteInfoProvider, {
                initialData: testSiteInfo,
                children: React.createElement(TopbarIsland),
              }),
            }),
          }),
        )
      })
    }

    try {
      // 1. 初始可见：只显示站名
      renderWithMode('visible')
      await new Promise(resolve => setTimeout(resolve, 60))
      expect(container.querySelector('[data-island-site]')).not.toBeNull()
      expect(container.querySelector('[data-island-capsule]')).toBeNull()

      // 2. 模拟切去后台/播放器：Activity 置为 hidden，期间全局活动登记
      renderWithMode('hidden')
      const dispose = store.showIslandActivity({
        id: 'test-activity',
        feature: 'reading',
        priority: 50,
        label: '阅读中',
        compact: React.createElement('span', null, '阅读进度 50%'),
      })
      await new Promise(resolve => setTimeout(resolve, 60))

      // 3. 切回前台：Activity 恢复 visible，应当只存在胶囊，站名不应残留并排
      renderWithMode('visible')
      expect(container.querySelector('[data-island-capsule]')).not.toBeNull()
      expect(container.querySelector('[data-island-site]')).toBeNull()

      // 4. 反向：胶囊在场时切走隐藏并撤下活动，再切回前台，应当只存在站名
      renderWithMode('hidden')
      dispose()
      await new Promise(resolve => setTimeout(resolve, 60))
      renderWithMode('visible')
      expect(container.querySelector('[data-island-site]')).not.toBeNull()
      expect(container.querySelector('[data-island-capsule]')).toBeNull()
    }
    finally {
      flushSync(() => root.unmount())
      container.remove()
      if (origAnimate)
        Element.prototype.animate = origAnimate
    }
  })
})
