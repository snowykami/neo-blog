'use client'

import type { UserBrief } from '@/models/user'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { UserAvatar } from '@/components/common/avatar'
import { cn } from '@/lib/utils'

/** 候选项的元素 id，输入框用 aria-activedescendant 指向当前选中的候选 */
export function mentionOptionId(listId: string, index: number) {
  return `${listId}-option-${index}`
}

/**
 * @ 提及的候选列表：显示在输入框下方，键盘上下选择、回车或点击确认。
 * actor 头像 + 昵称 + @用户名，标注 AI 账号；不显示邮箱等隐私字段
 */
export function MentionCandidates({
  id,
  candidates,
  activeIndex,
  loading,
  onPick,
  onHover,
}: {
  id: string
  candidates: UserBrief[]
  activeIndex: number
  loading: boolean
  onPick: (candidate: UserBrief) => void
  onHover: (index: number) => void
}) {
  const t = useTranslations('Comment')
  return (
    <div id={id} className="border-t border-dashed" role="listbox" aria-label={t('mention_candidates')}>
      {loading && candidates.length === 0
        ? (
            <div className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-xs">
              <Loader2 className="size-3 animate-spin" />
              {t('mention_searching')}
            </div>
          )
        : candidates.length === 0
          ? <div className="text-muted-foreground px-3 py-2 text-xs">{t('mention_empty')}</div>
          : candidates.map((candidate, index) => (
              <button
                key={candidate.id}
                id={mentionOptionId(id, index)}
                type="button"
                role="option"
                // 键盘在输入框里用上下键选择，候选本身不进 Tab 顺序
                tabIndex={-1}
                aria-selected={index === activeIndex}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
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
                  user={{ username: candidate.username, nickname: candidate.nickname, avatarUrl: candidate.avatarUrl, gravatarHash: '' }}
                  size={48}
                  className="size-6"
                />
                <span className="truncate">{candidate.nickname || candidate.username}</span>
                <span className="text-muted-foreground truncate text-xs">
                  @
                  {candidate.username}
                </span>
                {candidate.isAi && (
                  <span className="ml-auto rounded bg-muted px-1 text-[10px] font-medium">AI</span>
                )}
              </button>
            ))}
    </div>
  )
}
