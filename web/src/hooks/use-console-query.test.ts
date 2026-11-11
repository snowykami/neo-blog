import type { ConsoleQuery } from './use-console-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axiosClient from '@/api/client'
import { clearConsoleQueryCache, useConsoleQuery } from './use-console-query'

const auth = vi.hoisted(() => ({ user: { id: 1 } as { id: number } | null }))
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: auth.user }) }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function Probe({ queryKey, fetcher, onRender }: {
  queryKey: readonly unknown[]
  fetcher: () => Promise<string>
  onRender: (query: ConsoleQuery<string>) => void
}) {
  onRender(useConsoleQuery(queryKey, fetcher))
  return null
}

/** 挂载一次，返回每次渲染拿到的 data 与卸载函数 */
async function mount(queryKey: readonly unknown[], fetcher: () => Promise<string>) {
  const seen: (string | undefined)[] = []
  const root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(createElement(Probe, { queryKey, fetcher, onRender: q => seen.push(q.data) }))
  })
  return { seen, unmount: () => act(() => root.unmount()) }
}

describe('后台取数缓存', () => {
  beforeEach(() => {
    clearConsoleQueryCache()
    auth.user = { id: 1 }
  })
  afterEach(() => {
    axiosClient.defaults.adapter = undefined
  })

  it('回到看过的页面时第一帧就有上次的数据，同时重新请求', async () => {
    const first = await mount(['list', 1], async () => 'v1')
    await vi.waitFor(() => expect(first.seen.at(-1)).toBe('v1'))
    expect(first.seen[0]).toBeUndefined()
    first.unmount()

    let resolve!: (v: string) => void
    const fetcher = vi.fn(() => new Promise<string>((r) => {
      resolve = r
    }))
    const second = await mount(['list', 1], fetcher)
    expect(second.seen[0]).toBe('v1')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await act(async () => resolve('v2'))
    expect(second.seen.at(-1)).toBe('v2')
    second.unmount()
  })

  it('写操作后清空缓存，别的页面不会先显示旧数据', async () => {
    const first = await mount(['list', 2], async () => 'old')
    await vi.waitFor(() => expect(first.seen.at(-1)).toBe('old'))
    first.unmount()

    axiosClient.defaults.adapter = async config => ({ data: {}, status: 200, statusText: 'OK', headers: {}, config })
    await axiosClient.delete('/post/p/1')

    const second = await mount(['list', 2], () => new Promise<string>(() => {}))
    expect(second.seen.every(v => v === undefined)).toBe(true)
    second.unmount()
  })

  it('写操作进行中取回的结果不写回缓存', async () => {
    let resolveRead!: (v: string) => void
    const first = await mount(['list', 3], () => new Promise<string>((r) => {
      resolveRead = r
    }))
    axiosClient.defaults.adapter = async config => ({ data: {}, status: 200, statusText: 'OK', headers: {}, config })
    await axiosClient.put('/post/p/1', {})
    await act(async () => resolveRead('read-before-write'))
    expect(first.seen.at(-1)).toBe('read-before-write')
    first.unmount()

    const second = await mount(['list', 3], () => new Promise<string>(() => {}))
    expect(second.seen[0]).toBeUndefined()
    second.unmount()
  })

  it('打开编辑器占用编辑会话不算写操作', async () => {
    const first = await mount(['list', 5], async () => 'kept')
    await vi.waitFor(() => expect(first.seen.at(-1)).toBe('kept'))
    first.unmount()

    axiosClient.defaults.adapter = async config => ({ data: {}, status: 200, statusText: 'OK', headers: {}, config })
    await axiosClient.post('/post/p/1/edit-session')

    const second = await mount(['list', 5], () => new Promise<string>(() => {}))
    expect(second.seen[0]).toBe('kept')
    second.unmount()
  })

  it('不同用户之间不共用缓存', async () => {
    const first = await mount(['list', 4], async () => 'user-1')
    await vi.waitFor(() => expect(first.seen.at(-1)).toBe('user-1'))
    first.unmount()

    auth.user = { id: 2 }
    const second = await mount(['list', 4], () => new Promise<string>(() => {}))
    expect(second.seen[0]).toBeUndefined()
    second.unmount()
  })
})
