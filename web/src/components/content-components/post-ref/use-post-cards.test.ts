import type { PostCardState } from './use-post-cards'
import type { PostCard } from '@/models/post'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePostCard } from './use-post-cards'

const getPostCards = vi.hoisted(() => vi.fn())
vi.mock('@/api/post', () => ({ getPostCards }))

// React 19 的 act 需要这个标记，happy-dom 环境里没有测试框架自动设置
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function makeCard(id: number): PostCard {
  return {
    id,
    slug: null,
    title: `post ${id}`,
    description: '',
    cover: '',
    category: null,
    user: { id: 1, username: 'author', nickname: 'author' },
    likeCount: 0,
    viewCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as unknown as PostCard
}

/** 只把每次渲染状态交给调用方，不渲染任何 DOM */
function Card({ id, onState }: { id: number, onState: (state: PostCardState) => void }) {
  onState(usePostCard(id))
  return null
}

async function render(ids: number[], states: Record<number, PostCardState>) {
  const root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(createElement(
      'div',
      null,
      ...ids.map(id => createElement(Card, { key: id, id, onState: (state: PostCardState) => { states[id] = state } })),
    ))
  })
  return root
}

describe('文章引用卡片的数据', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('同一批挂载的卡片合并成一次请求，按 id 回填结果', async () => {
    vi.mocked(getPostCards).mockImplementation(async (ids: number[]) => ({ data: { cards: ids.map(makeCard) } } as never))
    const states: Record<number, PostCardState> = {}
    const root = await render([101, 102, 103], states)

    await vi.waitFor(() => expect(states[103]?.status).toBe('success'))
    expect(getPostCards).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getPostCards).mock.calls[0][0]).toEqual([101, 102, 103])
    expect(states[102]).toEqual({ status: 'success', card: expect.objectContaining({ id: 102 }) })
    await act(async () => root.unmount())
  })

  it('取不到的 id 视为不可访问，已取到的卡片不再重复请求', async () => {
    // 只返回 201，202 视为私密 / 已删除 / 不存在
    vi.mocked(getPostCards).mockImplementation(async ids => ({ data: { cards: ids.filter((id: number) => id === 201).map(makeCard) } } as never))
    const first: Record<number, PostCardState> = {}
    const root = await render([201, 202], first)
    await vi.waitFor(() => expect(first[202]?.status).toBe('success'))
    expect(first[201]).toEqual({ status: 'success', card: expect.objectContaining({ id: 201 }) })
    expect(first[202]).toEqual({ status: 'success', card: null })
    await act(async () => root.unmount())

    // 同一页面里再渲染已经取到的卡片：直接使用缓存，不再请求
    const second: Record<number, PostCardState> = {}
    const next = await render([201], second)
    await vi.waitFor(() => expect(second[201]?.status).toBe('success'))
    expect(getPostCards).toHaveBeenCalledTimes(1)
    await act(async () => next.unmount())
  })

  it('请求失败时不缓存，状态为 error', async () => {
    vi.mocked(getPostCards).mockRejectedValue(new Error('network'))
    const states: Record<number, PostCardState> = {}
    const root = await render([301], states)
    await vi.waitFor(() => expect(states[301]?.status).toBe('error'))
    await act(async () => root.unmount())

    // 失败不写入缓存：重新挂载会再次请求
    vi.mocked(getPostCards).mockImplementation(async (ids: number[]) => ({ data: { cards: ids.map(makeCard) } } as never))
    const retry: Record<number, PostCardState> = {}
    const next = await render([301], retry)
    await vi.waitFor(() => expect(retry[301]?.status).toBe('success'))
    expect(getPostCards).toHaveBeenCalledTimes(2)
    await act(async () => next.unmount())
  })
})
