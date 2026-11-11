import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePostLike } from './use-post-like'

const getLikeStatus = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => ({ user: null as { id: number } | null }))
vi.mock('@/api/like', () => ({ getLikeStatus, toggleLike: vi.fn() }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/components/auth/login-dialog', () => ({ useRequireLogin: () => (fn: () => void) => fn() }))
vi.mock('@/components/layout/topbar-island/island-feedback', () => ({ notifySuccess: vi.fn() }))
vi.mock('@/contexts/theme-context', () => ({ LikeIcon: () => null }))
vi.mock('@/hooks/use-translations', () => ({ useOperationT: () => (key: string) => key }))

// React 19 的 act 需要这个标记，happy-dom 环境里没有测试框架自动设置
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/** 按钮与灵动岛各用一次 hook，只记录状态，不渲染 DOM */
function Probe({ id, onLiked }: { id: number, onLiked: (liked: boolean) => void }) {
  onLiked(usePostLike({ id, isLiked: false, likeCount: 3 }).liked)
  return null
}

async function render(id: number, onLiked: (liked: boolean) => void) {
  const root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(createElement('div', null, createElement(Probe, { id, onLiked }), createElement(Probe, { id, onLiked })))
  })
  return root
}

/** 换了登录状态后重新渲染（auth 是模块里的同一个对象，改完再渲染一次让 hook 读到） */
async function rerender(root: ReturnType<typeof createRoot>, id: number, onLiked: (liked: boolean) => void) {
  await act(async () => {
    root.render(createElement('div', null, createElement(Probe, { id, onLiked }), createElement(Probe, { id, onLiked })))
  })
}

describe('文章点赞状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('访客不请求点赞状态，按未点赞显示', async () => {
    auth.user = null
    let liked: boolean | undefined
    const root = await render(1, (v) => {
      liked = v
    })
    expect(getLikeStatus).not.toHaveBeenCalled()
    expect(liked).toBe(false)
    act(() => root.unmount())
  })

  it('登录用户由浏览器读取自己的点赞状态，同一篇文章只请求一次', async () => {
    auth.user = { id: 7 }
    vi.mocked(getLikeStatus).mockResolvedValue({ data: { liked: true } } as never)
    let liked: boolean | undefined
    const root = await render(2, (v) => {
      liked = v
    })
    await vi.waitFor(() => expect(liked).toBe(true))
    expect(getLikeStatus).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getLikeStatus).mock.calls[0][0]).toEqual({ targetType: 'post', targetId: 2 })
    act(() => root.unmount())
  })

  it('登出后清掉上一个账号的点赞状态，换账号后按新账号重新读取', async () => {
    auth.user = { id: 7 }
    vi.mocked(getLikeStatus).mockResolvedValue({ data: { liked: true } } as never)
    let liked: boolean | undefined
    const onLiked = (v: boolean) => {
      liked = v
    }
    const root = await render(3, onLiked)
    await vi.waitFor(() => expect(liked).toBe(true))

    auth.user = null
    await rerender(root, 3, onLiked)
    expect(liked).toBe(false)

    vi.mocked(getLikeStatus).mockClear()
    vi.mocked(getLikeStatus).mockResolvedValue({ data: { liked: false } } as never)
    auth.user = { id: 8 }
    await rerender(root, 3, onLiked)
    await vi.waitFor(() => expect(getLikeStatus).toHaveBeenCalledTimes(1))
    expect(liked).toBe(false)
    act(() => root.unmount())
  })

  it('请求期间换了账号时丢弃上一个账号的结果', async () => {
    auth.user = { id: 9 }
    let resolveOld: (value: unknown) => void = () => {}
    vi.mocked(getLikeStatus).mockReturnValueOnce(new Promise((resolve) => {
      resolveOld = resolve
    }) as never)
    let liked: boolean | undefined
    const onLiked = (v: boolean) => {
      liked = v
    }
    const root = await render(4, onLiked)
    vi.mocked(getLikeStatus).mockResolvedValue({ data: { liked: false } } as never)
    auth.user = { id: 10 }
    await rerender(root, 4, onLiked)
    await act(async () => {
      resolveOld({ data: { liked: true } })
    })
    expect(liked).toBe(false)
    act(() => root.unmount())
  })

  it('访客登录不清掉已有的状态', async () => {
    auth.user = null
    let liked: boolean | undefined
    const onLiked = (v: boolean) => {
      liked = v
    }
    const root = await render(5, onLiked)
    vi.mocked(getLikeStatus).mockResolvedValue({ data: { liked: true } } as never)
    auth.user = { id: 11 }
    await rerender(root, 5, onLiked)
    await vi.waitFor(() => expect(liked).toBe(true))
    act(() => root.unmount())
  })
})
