'use client'

import type { UserBrief } from '@/models/user'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { UserAvatar } from '@/components/common/avatar'
import { cn } from '@/lib/utils'
import { MAX_COMMENT_MENTIONS } from './use-mention'

/** 候选项的元素 id，输入框用 aria-activedescendant 指向当前选中的候选 */
export function mentionOptionId(listId: string, index: number) {
  return `${listId}-option-${index}`
}

/**
 * @ 提及的浮动候选面板：以 Popover 浮层形式贴合评论框弹出，不撑高页面与工具栏。
 * 支持空 @ 展示当前上下文参与者、搜索加载态、3 人上限提示，以及键盘上下键自动滚动跟随
 */
export function MentionCandidates({
  id,
  candidates,
  activeIndex,
  loading,
  isEmptyQuery = false,
  atLimit = false,
  mentionCount = 0,
  ownerId,
  onPick,
  onHover,
}: {
  id: string
  candidates: UserBrief[]
  activeIndex: number
  loading: boolean
  isEmptyQuery?: boolean
  atLimit?: boolean
  mentionCount?: number
  ownerId?: number
  onPick: (candidate: UserBrief) => void
  onHover: (index: number) => void
}) {
  const t = useTranslations('Comment')
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, candidates.length])

  const headerLabel = atLimit
    ? t('mentions_max', { count: MAX_COMMENT_MENTIONS })
    : isEmptyQuery
      ? (candidates.length > 0 ? t('mention_suggested') : t('mention_type_hint'))
      : t('mention_candidates')

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className={cn('inline-flex min-w-0 items-center gap-1.5 truncate', atLimit && 'font-medium text-amber-600 dark:text-amber-400')}>
          <span className="truncate">{headerLabel}</span>
          {loading && candidates.length > 0 && <Loader2 aria-hidden className="size-3 shrink-0 animate-spin" />}
        </span>
        {mentionCount > 0 && (
          <span className="shrink-0 tabular-nums">{`${mentionCount}/${MAX_COMMENT_MENTIONS}`}</span>
        )}
      </div>
      <div
        id={id}
        role="listbox"
        aria-label={t('mention_candidates')}
        className="max-h-60 overflow-y-auto overscroll-contain p-1"
      >
        {atLimit
          ? null
          : loading && candidates.length === 0
            ? (
                <div className="flex items-center gap-2 px-2.5 py-2.5 text-xs text-muted-foreground">
                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                  {t('mention_searching')}
                </div>
              )
            : candidates.length === 0
              ? (
                  <div className="px-2.5 py-2.5 text-xs text-muted-foreground">
                    {isEmptyQuery ? t('mention_type_hint') : t('mention_empty')}
                  </div>
                )
              : candidates.map((candidate, index) => (
                  <button
                    key={candidate.id}
                    ref={(el) => { optionRefs.current[index] = el }}
                    id={mentionOptionId(id, index)}
                    type="button"
                    role="option"
                    // 键盘在输入框里用上下键选择，候选本身不进 Tab 顺序
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    className={cn(
                      'flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
                      index === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                    )}
                    onMouseEnter={() => onHover(index)}
                    // onMouseDown 阻止默认行为，避免先让输入框失焦
                    onMouseDown={(e) => {
                      e.preventDefault()
                      onPick(candidate)
                    }}
                  >
                    <UserAvatar
                      user={{
                        username: candidate.username,
                        nickname: candidate.nickname,
                        avatarUrl: candidate.avatarUrl,
                        gravatarHash: candidate.gravatarHash ?? '',
                      }}
                      size={48}
                      className="size-6 shrink-0"
                    />
                    <span className="truncate font-medium">{candidate.nickname || candidate.username}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      @
                      {candidate.username}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      {ownerId !== undefined && candidate.id === ownerId && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {t('mention_author')}
                        </span>
                      )}
                      {candidate.isAi && (
                        <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium">AI</span>
                      )}
                    </span>
                  </button>
                ))}
      </div>
    </div>
  )
}
