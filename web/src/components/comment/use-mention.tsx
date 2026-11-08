'use client'

import type { RefObject } from 'react'
import type { User } from '@/models/user'
import { useCallback, useEffect, useRef, useState } from 'react'
import { searchUsers } from '@/api/user'

// 正在输入的提及片段：start 是 @ 的位置，query 是 @ 之后已经输入的字符
interface MentionQuery {
  start: number
  query: string
}

// 触发搜索的最少字符数与防抖间隔
const MENTION_MIN_CHARS = 1
const MENTION_DEBOUNCE_MS = 250

/**
 * 评论框里的 @ 提及：检测光标前的 @片段，防抖搜索用户，支持键盘上下选择与回车确认。
 * 中文输入法组词期间不触发（composition），否则打「@」后继续打拼音会一直弹候选。
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
  const [candidates, setCandidates] = useState<User[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  // 提交时只认仍然留在正文里的提及；seedIds 是编辑已有评论时原来就有的人
  const [picked, setPicked] = useState<User[]>([])
  const [seedIds, setSeedIds] = useState<number[]>([])
  const composing = useRef(false)

  // 检查光标前是否正在输入一个 mention
  const detect = useCallback((text: string, cursor: number): MentionQuery | null => {
    const before = text.slice(0, cursor)
    const at = before.lastIndexOf('@')
    if (at < 0)
      return null
    const fragment = before.slice(at + 1)
    // @ 必须在开头或空白之后，且片段里不能有空白（否则是邮箱或普通文本）
    if (at > 0 && !/\s/.test(before[at - 1]))
      return null
    if (/\s/.test(fragment) || fragment.length > 20)
      return null
    return { start: at, query: fragment }
  }, [])

  const syncFromCursor = useCallback(() => {
    const node = textareaRef.current
    if (!node || composing.current)
      return
    const detected = detect(node.value, node.selectionStart ?? 0)
    setQuery(detected)
    if (!detected)
      setCandidates([])
  }, [detect, textareaRef])

  // 关键词变化后防抖搜索
  useEffect(() => {
    if (!query || query.query.length < MENTION_MIN_CHARS) {
      setCandidates([])
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      searchUsers({ query: query.query }).then((res) => {
        if (cancelled)
          return
        setCandidates(res.data.users ?? [])
        setActiveIndex(0)
      }).catch(() => {
        if (!cancelled)
          setCandidates([])
      }).finally(() => {
        if (!cancelled)
          setLoading(false)
      })
    }, MENTION_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  // 选中候选：把 @片段 换成 @用户名 并补一个空格，光标落到空格之后
  const select = useCallback((candidate: User) => {
    if (!query)
      return
    const node = textareaRef.current
    const cursor = node?.selectionStart ?? value.length
    const inserted = `@${candidate.username} `
    const next = value.slice(0, query.start) + inserted + value.slice(cursor)
    onChange(next)
    setPicked(prev => (prev.some(item => item.id === candidate.id) ? prev : [...prev, candidate]))
    setQuery(null)
    setCandidates([])
    // 等 React 更新 value 之后再放光标
    window.setTimeout(() => {
      const caret = query.start + inserted.length
      node?.focus()
      node?.setSelectionRange(caret, caret)
    }, 0)
  }, [onChange, query, textareaRef, value])

  // 键盘：展开时拦截上下键与回车
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
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
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      select(candidates[activeIndex])
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setQuery(null)
      setCandidates([])
      return true
    }
    return false
  }, [activeIndex, candidates, select])

  // 提交时的提及 id：编辑前已有的人 + 这次新选的人；正文里已被删掉的这次新选不再提交
  const mentions = useCallback((): number[] => {
    const ids = picked
      .filter(candidate => value.includes(`@${candidate.username}`))
      .map(candidate => candidate.id)
    return [...new Set([...seedIds, ...ids])]
  }, [picked, seedIds, value])

  return {
    open: candidates.length > 0 && query !== null,
    loading,
    candidates,
    activeIndex,
    setActiveIndex,
    select,
    handleKeyDown,
    syncFromCursor,
    setComposing: (next: boolean) => {
      composing.current = next
      if (next) {
        setQuery(null)
        setCandidates([])
      }
    },
    mentions,
    reset: () => {
      setPicked([])
      setSeedIds([])
      setQuery(null)
      setCandidates([])
    },
    // seed 把编辑前已有的提及 id 带回来，提交时一并写回
    seed: (ids: number[]) => setSeedIds(ids),
  }
}
