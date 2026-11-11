'use client'

import type { Post } from '@/models/post'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { getLikeStatus, toggleLike } from '@/api/like'
import { useRequireLogin } from '@/components/auth/login-dialog'
import { notifySuccess } from '@/components/layout/topbar-island/island-feedback'
import { useAuth } from '@/contexts/auth-context'
import { LikeIcon } from '@/contexts/theme-context'
import { useOperationT } from '@/hooks/use-translations'
import { TargetType } from '@/models/types'

interface PostLikeState {
  liked: boolean
  count: number
  // 请求进行中，期间忽略重复点击
  pending: boolean
  // 服务端确认后自增（点赞用户列表据此刷新，不能依赖乐观状态，否则会在服务端更新前拉取）
  version: number
}

/**
 * 文章的点赞状态：页面上的点赞按钮与顶栏灵动岛的「读完啦」提示共用一份（按文章 id 存在模块级仓库），
 * 在岛上点赞后页面上的按钮同步变化。服务端渲染不带登录身份（页面对所有人一致），首次渲染按未点赞显示，
 * 登录用户进入页面后由浏览器读取自己的点赞状态写入仓库
 */
const states = new Map<number, PostLikeState>()
const listeners = new Set<() => void>()
// 已读取过点赞状态的「用户:文章」，按钮与灵动岛共用一次请求
const fetchedStatus = new Set<string>()

// 仓库里的点赞状态属于哪个账号：null 为访客，undefined 为还没有组件读到过登录状态
let account: number | null | undefined
// 每次按账号重置加一：请求开始时记下，结束时不一致就说明期间登出或换了账号，结果属于上一个账号，丢弃
let generation = 0

/**
 * 登出或换账号时清掉上一个账号的点赞状态（点赞数是公开的，保留），新账号进入页面后重新读取。
 * 访客登录不清：访客没有自己的点赞状态，快捷登录后紧接着的点赞（乐观状态、请求进行中）不能被清掉
 */
export function syncPostLikeAccount(userId: number | null) {
  const previous = account
  account = userId
  if (previous === undefined || previous === null || previous === userId)
    return
  generation++
  fetchedStatus.clear()
  for (const [id, state] of states)
    states.set(id, { ...state, liked: false, pending: false, version: 0 })
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setState(id: number, state: PostLikeState) {
  states.set(id, state)
  listeners.forEach(listener => listener())
}

/**
 * 用浏览器另取的最新点赞数（见 use-post-stats.ts）替换页面里的快照；本页已经点过赞或请求进行中时以本地为准
 */
export function syncPostLikeCount(id: number, count: number) {
  const current = states.get(id)
  if (current && (current.pending || current.version > 0))
    return
  setState(id, { liked: current?.liked ?? false, count, pending: false, version: 0 })
}

export function usePostLike(post: Pick<Post, 'id' | 'isLiked' | 'likeCount'>) {
  const operationT = useOperationT()
  const requireLogin = useRequireLogin()
  const initial = useMemo<PostLikeState>(() => ({ liked: post.isLiked, count: post.likeCount || 0, pending: false, version: 0 }), [post.isLiked, post.likeCount])
  const state = useSyncExternalStore(subscribe, () => states.get(post.id) ?? initial, () => initial)
  const { user } = useAuth()

  // 登录用户读取自己的点赞状态；请求期间已经点过（pending 或状态已变）时以本地为准
  // 先按当前账号清掉上一个账号的状态（见 syncPostLikeAccount），再读取
  const userId = user?.id ?? null
  useEffect(() => {
    syncPostLikeAccount(userId)
    const key = userId !== null ? `${userId}:${post.id}` : ''
    if (userId === null || fetchedStatus.has(key))
      return
    fetchedStatus.add(key)
    const requestGeneration = generation
    getLikeStatus({ targetType: TargetType.Post, targetId: post.id })
      .then((res) => {
        if (generation !== requestGeneration)
          return
        const current = states.get(post.id) ?? initial
        if (current.pending || current.version > 0)
          return
        setState(post.id, { ...current, liked: res.data.liked })
      })
      .catch(() => {
        fetchedStatus.delete(key)
      })
  }, [initial, post.id, userId])

  // 改成期望的状态：先乐观更新，以服务端结果为准校正，失败时回滚。传入期望状态而不是取反：
  // 快捷登录后页面上的状态可能已过期，避免把已赞的点成取消
  const setLiked = useCallback((liked: boolean) => {
    const current = states.get(post.id) ?? initial
    if (current.pending || current.liked === liked)
      return
    setState(post.id, { ...current, liked, count: current.count + (liked ? 1 : -1), pending: true })
    const requestGeneration = generation
    toggleLike({ targetType: TargetType.Post, targetId: post.id, liked })
      .then((res) => {
        // 请求期间登出或换了账号：仓库已按新账号重置，不再写回上一个账号的结果
        if (generation !== requestGeneration)
          return
        const status = res.data.status
        // 操作反馈走岛上的 feedback 层（见 components/layout/topbar-island/island-feedback.tsx）：
        // 能以约 1.4 秒的短提示盖过其他提示，开关关闭或后台页时自动回落 toast。
        // 注意：乐观更新只作用于按钮状态，这句提示要等接口返回才上岛（失败时只弹 toast）
        // 点赞时岛上的爱心（节日主题下为节日图形）随主题变化；取消点赞只给一句确认
        if (status)
          notifySuccess(operationT('like_success'), { key: 'like', icon: <LikeIcon aria-hidden className="fill-current text-rose-400" /> })
        else
          notifySuccess(operationT('unlike_success'), { key: 'unlike' })
        setState(post.id, { liked: status, count: current.count + (status === current.liked ? 0 : status ? 1 : -1), pending: false, version: current.version + 1 })
      })
      .catch((error) => {
        toast.error(`${operationT('like_failed')}: ${error.message}`)
        if (generation === requestGeneration)
          setState(post.id, { ...current, pending: false })
      })
  }, [initial, operationT, post.id])

  return {
    liked: state.liked,
    count: state.count,
    version: state.version,
    // 未登录时弹出快捷登录，登录后接着执行；登录后读取最新的状态再决定（取反或点赞）
    toggle: () => requireLogin(() => setLiked(!(states.get(post.id) ?? initial).liked), 'like'),
    like: () => requireLogin(() => setLiked(true), 'like'),
  }
}
