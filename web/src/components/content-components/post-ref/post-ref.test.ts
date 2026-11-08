import type { ReactNode } from 'react'
import type { PostCardState } from './use-post-cards'
import type { PostCard } from '@/models/post'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PostRefCard from './post-ref'

// React 19 的 act 需要这个标记，happy-dom 环境里没有测试框架自动设置
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// 卡片的数据由 hook 提供，这里按用例切换状态
const state = vi.hoisted(() => ({ current: { status: 'loading' } as PostCardState }))
vi.mock('./use-post-cards', () => ({ usePostCard: () => state.current }))
// 只验证卡片自身的分支与链接，邻居组件换成最简实现
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: () => '2026-01-01',
    number: (value: number) => String(value),
  }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string, children: ReactNode }) => createElement('a', { href }, children),
}))
vi.mock('@/components/common/safe-image', () => ({ SafeImage: () => createElement('img', { alt: '' }) }))
vi.mock('@/components/common/avatar', () => ({ UserAvatar: () => createElement('span', null, 'avatar') }))
vi.mock('@/contexts/theme-context', () => ({ ViewIcon: () => createElement('span', null) }))

const card: PostCard = {
  id: 7,
  slug: 'hello-world',
  title: '文章标题',
  description: '**摘要**内容',
  cover: '/api/v1/file/cover.webp',
  category: { id: 1, name: '技术', description: '', slug: 'tech' } as PostCard['category'],
  user: { id: 1, username: 'author', nickname: '作者' } as PostCard['user'],
  likeCount: 3,
  viewCount: 1200,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

async function render() {
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(PostRefCard, { postId: 7, showCover: true }))
  })
  return { container, root }
}

describe('文章引用卡片', () => {
  beforeEach(() => {
    state.current = { status: 'loading' }
  })

  it('加载中只显示骨架，不引用任何文章信息', async () => {
    const { container } = await render()
    expect(container.textContent).toBe('')
  })

  it('拿到数据后整卡链接到文章，摘要去掉 Markdown 标记', async () => {
    state.current = { status: 'success', card }
    const { container } = await render()
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/p/hello-world')
    expect(container.textContent).toContain('文章标题')
    expect(container.textContent).toContain('摘要内容')
    expect(container.textContent).not.toContain('**')
  })

  it('文章不可访问与加载失败分别提示，不显示标题', async () => {
    state.current = { status: 'success', card: null }
    const unavailable = await render()
    expect(unavailable.container.textContent).toBe('unavailable')
    expect(unavailable.container.querySelector('a')).toBeNull()

    state.current = { status: 'error' }
    const failed = await render()
    expect(failed.container.textContent).toBe('load_failed')
  })
})
