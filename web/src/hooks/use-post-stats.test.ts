import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePostLike } from './use-post-like'
import { usePostStats } from './use-post-stats'

const getPostStats = vi.hoisted(() => vi.fn())
vi.mock('@/api/post', () => ({ getPostStats }))
vi.mock('@/api/like', () => ({ getLikeStatus: vi.fn(), toggleLike: vi.fn() }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/components/auth/login-dialog', () => ({ useRequireLogin: () => (fn: () => void) => fn() }))
vi.mock('@/components/layout/topbar-island/island-feedback', () => ({ notifySuccess: vi.fn() }))
vi.mock('@/contexts/theme-context', () => ({ LikeIcon: () => null }))
vi.mock('@/hooks/use-translations', () => ({ useOperationT: () => (key: string) => key }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/** 统计行与评论区各用一次计数，点赞按钮读点赞数 */
function Probe({ id, onRender }: { id: number, onRender: (views: number | undefined, likes: number) => void }) {
  const stats = usePostStats(id)
  const { count } = usePostLike({ id, isLiked: false, likeCount: 3 })
  onRender(stats?.viewCount, count)
  return null
}

describe('文章计数的最新值', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('同一页上的几处共用一次请求，点赞数同步给点赞按钮', async () => {
    vi.mocked(getPostStats).mockResolvedValue({ data: { viewCount: 42, likeCount: 9, commentCount: 1 } } as never)
    let views: number | undefined
    let likes = 0
    const onRender = (v: number | undefined, l: number) => {
      views = v
      likes = l
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement('div', null, createElement(Probe, { id: 11, onRender }), createElement(Probe, { id: 11, onRender })))
    })
    await vi.waitFor(() => expect(views).toBe(42))
    expect(likes).toBe(9)
    expect(getPostStats).toHaveBeenCalledTimes(1)
    expect(getPostStats).toHaveBeenCalledWith(11)
    act(() => root.unmount())
  })

  it('取不到时沿用快照', async () => {
    vi.mocked(getPostStats).mockRejectedValue(new Error('offline'))
    let views: number | undefined = -1
    let likes = 0
    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(createElement(Probe, {
        id: 12,
        onRender: (v, l) => {
          views = v
          likes = l
        },
      }))
    })
    await vi.waitFor(() => expect(getPostStats).toHaveBeenCalledTimes(1))
    expect(views).toBeUndefined()
    expect(likes).toBe(3)
    act(() => root.unmount())
  })
})
