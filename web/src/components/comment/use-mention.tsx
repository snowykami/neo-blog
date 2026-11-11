'use client'

import type { RefObject } from 'react'
import type { UserBrief } from '@/models/user'
import type { MentionQuery } from '@/utils/common/mention'
import { useCallback, useEffect, useRef, useState } from 'react'
import { searchUsers } from '@/api/user'
import { detectMentionQuery, mentionsUser } from '@/utils/common/mention'

// 触发搜索的最少字符数与防抖间隔
export const MENTION_MIN_CHARS = 1
export const MENTION_DEBOUNCE_MS = 250

// 提交时用到的被 @ 的人：只需要 id 与用户名（判断是否仍留在正文里）
interface MentionUser {
  id: number
  username: string
}

const EMPTY: UserBrief[] = []

function sameQuery(a: MentionQuery | null, b: MentionQuery | null) {
  return a === b || (a !== null && b !== null && a.start === b.start && a.query === b.query)
}

/**
 * 评论框里的 @ 提及：检测光标前的 @片段，防抖搜索用户，支持键盘上下选择与回车确认。
 * 中文输入法组词期间不触发（composition），否则打「@」后继续打拼音会一直弹候选。
 * 片段（位置与文字）没变时不重新搜索：方向键、点击只移动光标，不会把选中项重置回第一个
 */
export function useMention({
  value,
  textareaRef,
  onChange,
}: {
  value: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onChange: (next: string) => void
}) {
  const [query, setQuery] = useState<MentionQuery | null>(null)
  // 搜索结果连同它对应的关键词：关键词变了、新结果还没回来时仍显示上一次的候选，并视为搜索中
  const [results, setResults] = useState<{ term: string, users: UserBrief[] } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // 提交时只认仍然留在正文里的提及；seeds 是编辑已有评论时原来就有的人
  const [picked, setPicked] = useState<MentionUser[]>([])
  const [seeds, setSeeds] = useState<MentionUser[]>([])
  const composing = useRef(false)
  // 按 Esc 收起的片段：片段没变（例如 Esc 的 keyup、方向键）时不再弹出，继续输入后照常弹出
  const dismissed = useRef<MentionQuery | null>(null)

  const syncFromCursor = useCallback(() => {
    const node = textareaRef.current
    if (!node || composing.current)
      return
    let detected = detectMentionQuery(node.value, node.selectionStart ?? 0)
    if (detected && sameQuery(detected, dismissed.current))
      detected = null
    else
      dismissed.current = null
    // 片段没变时保留原对象，不触发重新搜索
    setQuery(prev => (sameQuery(prev, detected) ? prev : detected))
  }, [textareaRef])

  // 关键词变化后防抖搜索；只依赖片段文字，光标在片段内移动不会重新搜索
  const term = query && query.query.length >= MENTION_MIN_CHARS ? query.query : null
  useEffect(() => {
    if (term === null) {
      setResults(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      searchUsers({ query: term }).then((res) => {
        if (cancelled)
          return
        setResults({ term, users: res.data.users ?? [] })
        setActiveIndex(0)
      }).catch(() => {
        if (!cancelled)
          setResults({ term, users: [] })
      })
    }, MENTION_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [term])
  const candidates = term === null ? EMPTY : results?.users ?? EMPTY
  const loading = term !== null && results?.term !== term

  const close = useCallback(() => setQuery(null), [])

  // 选中候选：把 @片段 换成 @用户名 并补一个空格，光标落到空格之后
  const select = useCallback((candidate: UserBrief) => {
    if (!query)
      return
    const node = textareaRef.current
    const cursor = node?.selectionStart ?? value.length
    const inserted = `@${candidate.username} `
    const next = value.slice(0, query.start) + inserted + value.slice(cursor)
    onChange(next)
    setPicked(prev => (prev.some(item => item.id === candidate.id) ? prev : [...prev, candidate]))
    close()
    // 等 React 更新 value 之后再放光标
    window.setTimeout(() => {
      const caret = query.start + inserted.length
      node?.focus()
      node?.setSelectionRange(caret, caret)
    }, 0)
  }, [close, onChange, query, textareaRef, value])

  const open = term !== null

  // 键盘：有候选时拦截上下键与回车；候选列表打开时 Esc 收起
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
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
  }, [activeIndex, candidates, close, open, query, select])

  // 提交时的提及 id：编辑前已有的人 + 这次新选的人，都只保留正文里仍写着 @用户名 的（规则与后端一致），
  // 否则删掉的人仍会提交，可能超过上限被后端拒绝
  const mentions = useCallback((): number[] => {
    const ids = [...seeds, ...picked]
      .filter(user => mentionsUser(value, user.username))
      .map(user => user.id)
    return [...new Set(ids)]
  }, [picked, seeds, value])

  return {
    // 打开后先显示「搜索中」，结果为空时显示「没有匹配」
    open,
    loading,
    candidates,
    activeIndex,
    setActiveIndex,
    select,
    handleKeyDown,
    syncFromCursor,
    setComposing: (next: boolean) => {
      composing.current = next
      if (next)
        close()
    },
    mentions,
    reset: () => {
      setPicked([])
      setSeeds([])
      dismissed.current = null
      close()
    },
    // seed 把编辑前已有的提及（id 与当前用户名）带回来，提交时仍留在正文里的一并写回
    seed: (users: MentionUser[]) => setSeeds(users),
  }
}
