'use client'

import type { PostCard } from '@/models/post'
import { useEffect, useState } from 'react'
import { getPostCards } from '@/api/post'

/**
 * 文章引用卡片的数据：同一页面内的卡片合并成一次请求
 * - 组件岛在一次提交内挂载全部组件，各自的 effect 会先登记 id，再在下一个宏任务里统一取数
 * - 已取到的卡片在同一页面内复用（编辑器反复重渲染、同一篇文章被引用多次都不会重复请求）
 * - 取不到的 id（私密、已删除、已不存在）缓存为 null，渲染成「内容不可访问」
 * - 请求失败不缓存，重新挂载时会再次请求
 */

export type PostCardState
  = | { status: 'loading' }
    | { status: 'success', card: PostCard | null }
    | { status: 'error' }

type Listener = (state: PostCardState) => void

const cards = new Map<number, PostCard | null>()
const listeners = new Map<number, Set<Listener>>()
// 等待合并请求的 id
const pending = new Set<number>()
let flushTimer: ReturnType<typeof setTimeout> | undefined

function readCached(id: number): PostCardState {
  // 0 表示还没选文章，直接按不可访问处理，等属性弹窗补全
  if (id <= 0)
    return { status: 'success', card: null }
  if (!cards.has(id))
    return { status: 'loading' }
  return { status: 'success', card: cards.get(id) ?? null }
}

function settle(id: number, state: PostCardState) {
  listeners.get(id)?.forEach(listener => listener(state))
  listeners.delete(id)
}

function flush() {
  flushTimer = undefined
  const ids = [...pending]
  pending.clear()
  if (!ids.length)
    return
  getPostCards(ids).then(({ data }) => {
    const byID = new Map(data.cards.map(card => [card.id, card]))
    for (const id of ids) {
      const card = byID.get(id) ?? null
      cards.set(id, card)
      settle(id, { status: 'success', card })
    }
  }, () => {
    for (const id of ids)
      settle(id, { status: 'error' })
  })
}

/** 读取一篇文章的卡片数据：同一批挂载的卡片共用一个请求 */
export function usePostCard(id: number): PostCardState {
  const [state, setState] = useState<{ id: number, value: PostCardState }>(() => ({ id, value: readCached(id) }))

  useEffect(() => {
    if (id <= 0)
      return
    const cached = readCached(id)
    if (cached.status !== 'loading') {
      setState({ id, value: cached })
      return
    }
    let waiting = listeners.get(id)
    if (!waiting) {
      waiting = new Set()
      listeners.set(id, waiting)
    }
    const listener: Listener = value => setState({ id, value })
    waiting.add(listener)
    pending.add(id)
    flushTimer ??= setTimeout(flush, 0)
    return () => {
      waiting.delete(listener)
    }
  }, [id])

  // id 变化后、新结果返回前按加载中处理
  return state.id === id ? state.value : readCached(id)
}
