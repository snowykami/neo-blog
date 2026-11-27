import type { MisskeyFeed } from '@/models/misskey'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlogSidebarMisskey } from './blog-sidebar-card'

const getMisskeyFeedSpy = vi.fn()

vi.mock('@/api/misskey', () => ({
  getMisskeyFeed: () => getMisskeyFeedSpy(),
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
  }),
}))

describe('blogSidebarMisskey 侧边栏动态卡片', () => {
  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    getMisskeyFeedSpy.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('未启用或已抓取但无公开动态时不发客户端请求且返回空内容，传入有效动态时安全渲染纯文本与合规缩略图', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(React.createElement(BlogSidebarMisskey, { initialFeed: { enabled: false, notes: [] } }))
      })
      expect(container.innerHTML).toBe('')
      expect(getMisskeyFeedSpy).not.toHaveBeenCalled()

      // 已完成抓取但用户确实只有 0 条公开动态（fetchedAt 非空）：客户端零请求
      await act(async () => {
        root.render(React.createElement(BlogSidebarMisskey, {
          initialFeed: { enabled: true, fetchedAt: '2026-11-28T02:00:00Z', notes: [] },
        }))
      })
      expect(container.innerHTML).toBe('')
      expect(getMisskeyFeedSpy).not.toHaveBeenCalled()

      const sampleFeed: MisskeyFeed = {
        enabled: true,
        fetchedAt: '2026-11-28T02:00:00Z',
        instanceUrl: 'https://lab.liteyuki.org',
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
          },
          {
            id: 'n2',
            url: 'javascript:alert(1)',
            text: '普通公开笔记',
            createdAt: '2026-11-28T01:00:00Z',
            isRenote: true,
            renoteUser: 'Alice',
          },
        ],
      }

      await act(async () => {
        root.render(React.createElement(BlogSidebarMisskey, { initialFeed: sampleFeed }))
      })
      expect(getMisskeyFeedSpy).not.toHaveBeenCalled()
      expect(container.textContent).toContain('Snowykami')
      expect(container.textContent).toContain('@snowykami')
      expect(container.textContent).toContain('折叠预警标题')
      expect(container.textContent).not.toContain('纯文本防注入')

      const cwBtn = container.querySelector('button')!
      await act(async () => {
        cwBtn.click()
      })
      expect(container.textContent).toContain('纯文本防注入 <img src=x onerror=alert(1)>')
      expect(container.querySelector('img[onerror]')).toBeNull()
      // 校验缩略图 quality 为白名单内的 60 档位，主页链接含 rel="noopener noreferrer me"
      expect(container.querySelector('img[data-quality="60"]')).not.toBeNull()
      expect(container.querySelector('a[href="https://lab.liteyuki.org/@snowykami"]')?.getAttribute('rel')).toContain('me')
      const anchors = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href'))
      expect(anchors).not.toContain('javascript:alert(1)')
      expect(anchors).toContain('https://lab.liteyuki.org/notes/n1')
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

      // 继续推进时间确认不再发起第三次请求（无常驻轮询）
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
})
