'use client'

import type { RefObject } from 'react'
import type { UserBrief } from '@/models/user'
import type { MentionQuery } from '@/utils/common/mention'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { searchUsers } from '@/api/user'
import { isComposingKey } from '@/lib/ime'
import { detectMentionQuery, mentionsUser, needsSpaceBeforeMention } from '@/utils/common/mention'

// 防抖间隔与单条评论提及人数上限（与后端 internal/service/comment_mention.go 的 maxCommentMentions 一致）
export const MENTION_DEBOUNCE_MS = 200
export const MAX_COMMENT_MENTIONS = 3
const LOCAL_CANDIDATE_LIMIT = 8
const MERGED_CANDIDATE_LIMIT = 10

// 提交时用到的被 @ 的人：只需要 id 与用户名（判断是否仍留在正文里）
export interface MentionUser {
  id: number
  username: string
  nickname?: string
}

const EMPTY: UserBrief[] = []

function sameQuery(a: MentionQuery | null, b: MentionQuery | null) {
  return a === b || (a !== null && b !== null && a.start === b.start && a.query === b.query)
}

function matchLocalUser(user: UserBrief, lowerTerm: string) {
  return user.username.toLowerCase().includes(lowerTerm)
    || Boolean(user.nickname && user.nickname.toLowerCase().includes(lowerTerm))
}

function exactMatchUser(user: UserBrief, lowerTerm: string) {
  return user.username.toLowerCase() === lowerTerm
    || Boolean(user.nickname && user.nickname.toLowerCase() === lowerTerm)
}

/**
 * 评论框里的 @ 提及：
 * - 敲下空「@」立即 0ms 展示当前上下文候选（文章作者、本楼层与评论区参与者），继续输入再防抖走后端全站/拼音搜索
 * - 中文输入法（IME）组字期间不抢方向键/回车/Esc，选词上屏（compositionend）后立即同步光标弹出候选
 * - 追踪当前正文中实际生效的提及名单（最多 3 人），供输入框底层同色高亮与上限提示使用
 */
export function useMention({
  value,
  textareaRef,
  onChange,
  contextUsers = EMPTY,
  currentUserId,
  onExceedLimit,
}: {
  value: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onChange: (next: string) => void
  contextUsers?: UserBrief[]
  currentUserId?: number
  onExceedLimit?: () => void
}) {
  const [query, setQuery] = useState<MentionQuery | null>(null)
  const [composing, setComposingState] = useState(false)
  // 本次输入会话内的搜索结果缓存：回退删除关键词时 0ms 命中，同时节省后端每分钟限流配额
  const [cache, setCache] = useState<Record<string, UserBrief[]>>({})
  const [selection, setSelection] = useState<{ key: string, index: number }>({ key: '', index: 0 })
  // 提交时只认仍然留在正文里的提及；seeds 是编辑已有评论时原来就有的人
  const [picked, setPicked] = useState<MentionUser[]>([])
  const [seeds, setSeeds] = useState<MentionUser[]>([])
  const composingRef = useRef(false)
  // 按 Esc 收起的片段：片段没变（例如 Esc 的 keyup、方向键）时不再弹出，继续输入后照常弹出
  const dismissed = useRef<MentionQuery | null>(null)

  const syncFromCursor = useCallback(() => {
    const node = textareaRef.current
    if (!node || composingRef.current)
      return
    let detected = detectMentionQuery(node.value, node.selectionStart ?? 0)
    if (detected && sameQuery(detected, dismissed.current))
      detected = null
    else
      dismissed.current = null
    // 片段没变时保留原对象，不触发重新搜索或重置选中项
    setQuery(prev => (sameQuery(prev, detected) ? prev : detected))
  }, [textareaRef])

  // 本地上下文候选池：去重、排除自己
  const localPool = useMemo(() => {
    const seen = new Set<number>()
    const list: UserBrief[] = []
    for (const item of contextUsers) {
      if (!item?.id || !item.username || item.id === currentUserId || seen.has(item.id))
        continue
      seen.add(item.id)
      list.push(item)
    }
    return list
  }, [contextUsers, currentUserId])

  // 当前正文里实际生效的被 @ 用户（去重、排除自己、按首次选择顺序最多保留 3 人，与后端校验一致）
  const activeMentions = useMemo(() => {
    const seen = new Set<number>()
    const valid: MentionUser[] = []
    for (const user of [...seeds, ...picked]) {
      if (!user.id || !user.username || user.id === currentUserId || seen.has(user.id))
        continue
      if (!mentionsUser(value, user.username))
        continue
      seen.add(user.id)
      valid.push(user)
      if (valid.length >= MAX_COMMENT_MENTIONS)
        break
    }
    return valid
  }, [currentUserId, picked, seeds, value])

  const activeIds = useMemo(() => new Set(activeMentions.map(u => u.id)), [activeMentions])
  const activeUsernames = useMemo(() => activeMentions.map(u => u.username), [activeMentions])
  const atLimit = activeMentions.length >= MAX_COMMENT_MENTIONS

  // 空 @ 只看本地上下文，不打接口；输入至少 1 个字符且未满上限时防抖查询全站（含 Meilisearch 拼音匹配）
  const term = query && query.query.length >= 1 && !atLimit ? query.query : null
  const hasCached = term !== null && Object.hasOwn(cache, term)

  useEffect(() => {
    if (term === null || hasCached)
      return
    let cancelled = false
    const timer = window.setTimeout(() => {
      searchUsers({ query: term }).then((res) => {
        if (cancelled)
          return
        const users = res.data.users ?? []
        setCache(prev => (Object.hasOwn(prev, term) ? prev : { ...prev, [term]: users }))
      }).catch(() => {
        if (!cancelled)
          setCache(prev => (Object.hasOwn(prev, term) ? prev : { ...prev, [term]: [] }))
      })
    }, MENTION_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [hasCached, term])

  const candidates = useMemo(() => {
    if (!query || composing || atLimit)
      return EMPTY
    if (query.query === '')
      return localPool.filter(u => !activeIds.has(u.id)).slice(0, LOCAL_CANDIDATE_LIMIT)

    const lowerTerm = query.query.toLowerCase()
    const localMatches = localPool.filter(u => matchLocalUser(u, lowerTerm))
    if (!hasCached || term === null)
      return localMatches.filter(u => !activeIds.has(u.id)).slice(0, LOCAL_CANDIDATE_LIMIT)

    const localById = new Map(localPool.map(u => [u.id, u]))
    const mergedMap = new Map<number, UserBrief>()
    for (const u of [...localMatches, ...(cache[term] ?? [])]) {
      if (!u.id || !u.username || u.id === currentUserId || mergedMap.has(u.id))
        continue
      const local = localById.get(u.id)
      mergedMap.set(u.id, local?.gravatarHash && !u.gravatarHash ? { ...u, gravatarHash: local.gravatarHash } : u)
    }
    const merged = [...mergedMap.values()]
    merged.sort((a, b) => {
      // 未提及过的排在已提及过的前面；精确匹配最前，其次是本帖上下文参与者，其余保持后端相关性顺序
      const aMentioned = activeIds.has(a.id) ? 1 : 0
      const bMentioned = activeIds.has(b.id) ? 1 : 0
      if (aMentioned !== bMentioned)
        return aMentioned - bMentioned
      const aExact = exactMatchUser(a, lowerTerm) ? 0 : 1
      const bExact = exactMatchUser(b, lowerTerm) ? 0 : 1
      if (aExact !== bExact)
        return aExact - bExact
      const aLocal = localById.has(a.id) ? 0 : 1
      const bLocal = localById.has(b.id) ? 0 : 1
      return aLocal - bLocal
    })
    return merged.slice(0, MERGED_CANDIDATE_LIMIT)
  }, [activeIds, atLimit, cache, composing, currentUserId, hasCached, localPool, query, term])

  const loading = term !== null && !hasCached
  const open = query !== null && !composing
  const queryKey = query ? `${query.start}:${query.query}` : ''
  const rawIndex = selection.key === queryKey ? selection.index : 0
  const activeIndex = candidates.length > 0 ? Math.min(rawIndex, candidates.length - 1) : 0

  const setActiveIndex = useCallback((next: number | ((prev: number) => number)) => {
    setSelection((prev) => {
      const base = prev.key === queryKey ? prev.index : 0
      const resolved = typeof next === 'function' ? next(base) : next
      return { key: queryKey, index: resolved }
    })
  }, [queryKey])

  const close = useCallback(() => setQuery(null), [])

  // 选中候选：把 @片段 换成 @用户名（后面已有空格时不重复补空格），光标落到空格之后
  const select = useCallback((candidate: UserBrief) => {
    if (!query)
      return
    if (atLimit && !activeIds.has(candidate.id)) {
      onExceedLimit?.()
      dismissed.current = query
      close()
      textareaRef.current?.focus()
      return
    }
    const node = textareaRef.current
    const fallbackEnd = query.start + 1 + query.query.length
    const cursor = node?.selectionStart ?? fallbackEnd
    const hasTrailingSpace = value[cursor] === ' '
    const inserted = hasTrailingSpace ? `@${candidate.username}` : `@${candidate.username} `
    const next = value.slice(0, query.start) + inserted + value.slice(cursor)
    const caret = query.start + inserted.length + (hasTrailingSpace ? 1 : 0)
    onChange(next)
    setPicked(prev => (prev.some(item => item.id === candidate.id)
      ? prev.map(item => (item.id === candidate.id ? { id: candidate.id, username: candidate.username, nickname: candidate.nickname } : item))
      : [...prev, { id: candidate.id, username: candidate.username, nickname: candidate.nickname }]))
    close()
    // 等 React 更新 value 之后再放光标
    window.setTimeout(() => {
      node?.focus()
      node?.setSelectionRange(caret, caret)
    }, 0)
  }, [activeIds, atLimit, close, onChange, onExceedLimit, query, textareaRef, value])

  // 工具栏「@」快捷按钮：在光标处智能补前导空格并插入 @，立即唤起候选弹层
  const triggerMention = useCallback(() => {
    const node = textareaRef.current
    if (atLimit) {
      onExceedLimit?.()
      node?.focus()
      return
    }
    const start = node ? (node.selectionStart ?? value.length) : value.length
    const end = node ? (node.selectionEnd ?? start) : start
    if (start === end) {
      const existing = detectMentionQuery(value, start)
      if (existing) {
        dismissed.current = null
        setQuery(existing)
        node?.focus()
        return
      }
    }
    const prefix = needsSpaceBeforeMention(value, start) ? ' @' : '@'
    const next = value.slice(0, start) + prefix + value.slice(end)
    const caret = start + prefix.length
    dismissed.current = null
    onChange(next)
    setQuery({ start: caret - 1, query: '' })
    window.setTimeout(() => {
      node?.focus()
      node?.setSelectionRange(caret, caret)
    }, 0)
  }, [atLimit, onChange, onExceedLimit, textareaRef, value])

  // 键盘：IME 组字期间绝不拦截；有候选时拦截上下键与回车/Tab；弹层打开时 Esc 收起
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (isComposingKey(event) || composingRef.current)
      return false
    if (!open)
      return false
    if (event.key === 'Escape') {
      event.preventDefault()
      dismissed.current = query
      close()
      return true
    }
    if (candidates.length === 0)
      return false
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex(index => (index + 1) % candidates.length)
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(index => (index - 1 + candidates.length) % candidates.length)
      return true
    }
    // ⌘/Ctrl + Enter 是「发表评论」，不能拿来选候选
    const withModifier = event.metaKey || event.ctrlKey || event.altKey
    if (!withModifier && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault()
      select(candidates[Math.min(activeIndex, candidates.length - 1)])
      return true
    }
    return false
  }, [activeIndex, candidates, close, open, query, select, setActiveIndex])

  const mentions = useCallback((): number[] => {
    return activeMentions.map(user => user.id)
  }, [activeMentions])

  const setComposing = useCallback((next: boolean) => {
    composingRef.current = next
    setComposingState(next)
    if (next) {
      close()
    }
    else {
      // 中文输入法选词或回车上屏后（可能不触发后续 keyup），下一拍按最新文本与光标恢复检测
      window.setTimeout(syncFromCursor, 0)
    }
  }, [close, syncFromCursor])

  return {
    open,
    loading,
    composing,
    isEmptyQuery: query !== null && query.query === '',
    atLimit,
    mentionCount: activeMentions.length,
    activeUsernames,
    candidates,
    activeIndex,
    setActiveIndex,
    select,
    triggerMention,
    close,
    handleKeyDown,
    syncFromCursor,
    setComposing,
    mentions,
    reset: () => {
      setPicked([])
      setSeeds([])
      setCache({})
      dismissed.current = null
      close()
    },
    // seed 把编辑前已有的提及（id 与当前用户名）带回来，提交时仍留在正文里的一并写回
    seed: (users: MentionUser[]) => setSeeds(users),
  }
}
