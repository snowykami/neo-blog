'use client'

import type { PostStats } from '@/models/post'
import { useEffect, useSyncExternalStore } from 'react'
import { getPostStats } from '@/api/post'
import { syncPostLikeCount } from '@/hooks/use-post-like'

/**
 * 文章计数的最新值：文章页按 ISR 缓存，服务端渲染出的浏览量、点赞数、评论数是生成页面时的快照。
 * 进入文章页后浏览器取一次最新值（GET /post/p/:id/stats，不需要登录），页面上的几处（统计行、评论区）共用一次请求，
 * 点赞数同步给点赞按钮与灵动岛（见 use-post-like.tsx）。取到之前与取不到时沿用快照
 */
const stats = new Map<number, PostStats>()
// 正在请求的文章；几秒内重复挂载（同一页上的几个组件先后挂载）不再请求，再次进入文章页时重新取
const inflight = new Set<number>()
const fetchedAt = new Map<number, number>()
const REFETCH_AFTER_MS = 5000
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function load(postId: number) {
  if (!postId || inflight.has(postId) || Date.now() - (fetchedAt.get(postId) ?? 0) < REFETCH_AFTER_MS)
    return
  inflight.add(postId)
  getPostStats(postId)
    .then((res) => {
      fetchedAt.set(postId, Date.now())
      stats.set(postId, res.data)
      syncPostLikeCount(postId, res.data.likeCount)
      listeners.forEach(listener => listener())
    })
    .catch(() => {
      // 取不到时沿用页面里的快照
    })
    .finally(() => {
      inflight.delete(postId)
    })
}

/** 文章计数的最新值；postId 为 0 时不请求（评论区等通用组件用在非文章页时） */
export function usePostStats(postId: number): PostStats | undefined {
  const value = useSyncExternalStore(subscribe, () => stats.get(postId), () => undefined)
  useEffect(() => {
    load(postId)
  }, [postId])
  return value
}
