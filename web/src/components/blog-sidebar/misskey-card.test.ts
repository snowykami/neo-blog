import type { MisskeyFeed } from '@/models/misskey'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlogSidebarMisskey } from './blog-sidebar-card'

const getMisskeyFeedSpy = vi.fn()

vi.mock('@/api/misskey', () => ({
  getMisskeyFeed: (params?: unknown) => getMisskeyFeedSpy(params),
}))

vi.mock('@/components/common/avatar', () => ({
  ImageAvatar: ({ src, alt }: { src?: string, alt?: string }) => React.createElement('img', { src, alt }),
}))

vi.mock('@/components/common/safe-image', () => ({
  SafeImage: ({ src, alt, quality }: { src?: string, alt?: string, quality?: number }) =>
    React.createElement('img', { 'src': src, 'alt': alt, 'data-quality': String(quality ?? '') }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) =>
    params?.user ? `${key}:${params.user}` : key,
  useFormatter: () => ({
    dateTime: () => '11-28 02:00',
    relativeTime: () => '2小时前',
  }),
}))

describe('blogSidebarMisskey 侧边栏个人动态流卡片', () => {
  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    getMisskeyFeedSpy.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('未启用或已抓取但无公开动态时零请求返回空，传入分页动态时支持 CW 折叠、长文展开、结构化引用与按需加载更多', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(React.createElement(BlogSidebarMisskey, { initialFeed: { enabled: false, notes: [] } }))
      })
      expect(container.innerHTML).toBe('')
      expect(getMisskeyFeedSpy).not.toHaveBeenCalled()

      await act(async () => {
        root.render(React.createElement(BlogSidebarMisskey, {
          initialFeed: { enabled: true, fetchedAt: '2026-11-28T02:00:00Z', notes: [] },
        }))
      })
      expect(container.innerHTML).toBe('')
      expect(getMisskeyFeedSpy).not.toHaveBeenCalled()

      const longParagraph = '这是一段超过一百二十字限制的个人随记动态内容，用于验证侧边栏轻量级动态流默认四行折叠以及点击展开全文按钮原地阅读完整内容的交互行为。'.repeat(3)
      const sampleFeed: MisskeyFeed = {
        enabled: true,
        fetchedAt: '2026-11-28T02:05:00Z',
        instanceUrl: 'https://lab.liteyuki.org',
        total: 42,
        hasMore: true,
        nextCursor: 'n2',
        user: {
          username: 'snowykami',
          name: 'Snowykami',
          avatarUrl: 'https://lab.liteyuki.org/avatar.webp',
          profileUrl: 'https://lab.liteyuki.org/@snowykami',
        },
        notes: [
          {
            id: 'n1',
            url: 'https://lab.liteyuki.org/notes/n1',
            text: '纯文本防注入 <img src=x onerror=alert(1)>',
            cw: '折叠预警标题',
            createdAt: '2026-11-28T02:00:00Z',
            images: [{ thumbnailUrl: 'https://lab.liteyuki.org/pic.webp', alt: '配图' }],
            reactionsCount: 5,
          },
          {
            id: 'n2',
            url: 'javascript:alert(1)',
            text: longParagraph,
            createdAt: '2026-11-28T01:00:00Z',
            isRenote: true,
            renoteUser: 'Alice',
            quote: {
              username: 'bob',
              name: 'Bob',
              text: '被结构化引用的原帖内容',
              url: 'https://lab.liteyuki.org/notes/q1',
            },
          },
        ],
      }

      await act(async () => {
        root.render(React.createElement(BlogSidebarMisskey, { initialFeed: sampleFeed }))
      })
      expect(getMisskeyFeedSpy).not.toHaveBeenCalled()
      expect(container.textContent).toContain('Snowykami')
      expect(container.textContent).toContain('@snowykami')
      expect(container.textContent).toContain('42')
      expect(container.textContent).toContain('折叠预警标题')
      expect(container.textContent).not.toContain('纯文本防注入')
      expect(container.textContent).toContain('被结构化引用的原帖内容')

      // 1. 展开 CW
      const buttons = Array.from(container.querySelectorAll('button'))
      const cwBtn = buttons.find(b => b.textContent?.includes('show_cw'))!
      await act(async () => {
        cwBtn.click()
      })
      expect(container.textContent).toContain('纯文本防注入 <img src=x onerror=alert(1)>')
      expect(container.querySelector('img[onerror]')).toBeNull()
      expect(container.querySelector('img[data-quality="60"]')).not.toBeNull()
      expect(container.querySelector('a[href="https://lab.liteyuki.org/@snowykami"]')?.getAttribute('rel')).toContain('me')

      // 2. 长文展开与收起
      const expandBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('expand_text'))!
      expect(expandBtn).toBeDefined()
      await act(async () => {
        expandBtn.click()
      })
      expect(expandBtn.textContent).toContain('collapse_text')

      // 3. 安全协议过滤
      const anchors = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href'))
      expect(anchors).not.toContain('javascript:alert(1)')
      expect(anchors).toContain('https://lab.liteyuki.org/notes/n1')
      expect(anchors).toContain('https://lab.liteyuki.org/notes/q1')

      // 4. 分批加载更多（携带 cursor 与 offset，且自动去重）
      getMisskeyFeedSpy.mockResolvedValueOnce({
        data: {
          enabled: true,
          fetchedAt: '2026-11-28T02:05:00Z',
          total: 42,
          hasMore: false,
          notes: [
            { id: 'n2', url: 'https://lab.liteyuki.org/notes/n2', text: '重复项应被跳过', createdAt: '2026-11-28T01:00:00Z' },
            { id: 'n3', url: 'https://lab.liteyuki.org/notes/n3', text: '第二批滚动加载的动态', createdAt: '2026-11-28T00:30:00Z' },
          ],
        },
      })
      const loadMoreBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('load_more'))!
      await act(async () => {
        loadMoreBtn.click()
      })
      expect(getMisskeyFeedSpy).toHaveBeenCalledWith({ limit: 20, cursor: 'n2' })
      expect(container.textContent).toContain('第二批滚动加载的动态')
      expect(container.textContent).not.toContain('重复项应被跳过')
    }
    finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  })

  it('后端冷启动尚未完成抓取（enabled=true 但无 fetchedAt）时单次延迟重试，绝不开启常驻轮询', async () => {
    vi.useFakeTimers()
    getMisskeyFeedSpy
      .mockResolvedValueOnce({ data: { enabled: true, notes: [] } })
      .mockResolvedValueOnce({
        data: {
          enabled: true,
          fetchedAt: '2026-11-28T02:00:02Z',
          total: 1,
          hasMore: false,
          notes: [
            { id: 'c1', url: 'https://lab.liteyuki.org/notes/c1', text: '冷启动重试命中成功', createdAt: '2026-11-28T02:00:00Z' },
          ],
        },
      })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(React.createElement(BlogSidebarMisskey, { initialFeed: { enabled: true, notes: [] } }))
      })
      expect(getMisskeyFeedSpy).toHaveBeenCalledTimes(1)
      expect(container.innerHTML).toBe('')

      await act(async () => {
        vi.advanceTimersByTime(1600)
      })
      expect(getMisskeyFeedSpy).toHaveBeenCalledTimes(2)
      expect(container.textContent).toContain('冷启动重试命中成功')

      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      expect(getMisskeyFeedSpy).toHaveBeenCalledTimes(2)
    }
    finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  })

  it('滚动自动分页请求失败时立即熔断 IntersectionObserver 防无限请求风暴，点击按钮仍可手动恢复重试', async () => {
    let observerCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null
    class FakeIntersectionObserver {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
        observerCallback = cb
      }

      observe() {
        observerCallback?.([{ isIntersecting: true }])
      }

      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)

    getMisskeyFeedSpy
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        data: {
          enabled: true,
          fetchedAt: '2026-11-28T02:05:00Z',
          total: 2,
          hasMore: false,
          notes: [{ id: 'm2', url: 'https://lab.liteyuki.org/notes/m2', text: '手动重试恢复成功', createdAt: '2026-11-28T01:00:00Z' }],
        },
      })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(React.createElement(BlogSidebarMisskey, {
          initialFeed: {
            enabled: true,
            fetchedAt: '2026-11-28T02:05:00Z',
            total: 2,
            hasMore: true,
            nextCursor: 'm1',
            notes: [{ id: 'm1', url: 'https://lab.liteyuki.org/notes/m1', text: '首条动态', createdAt: '2026-11-28T02:00:00Z' }],
          },
        }))
      })
      // IntersectionObserver 首次进入可视区自动请求 1 次，失败后立即熔断，不会重建 Observer 触发第 2 次请求风暴
      expect(getMisskeyFeedSpy).toHaveBeenCalledTimes(1)

      const retryBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('load_more'))!
      expect(retryBtn).toBeDefined()
      await act(async () => {
        retryBtn.click()
      })
      expect(getMisskeyFeedSpy).toHaveBeenCalledTimes(2)
      expect(container.textContent).toContain('手动重试恢复成功')
    }
    finally {
      vi.unstubAllGlobals()
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  })
})
