'use client'

import type { PostRefProps } from './schema'
import { FileTextIcon, LinkIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { UserAvatar } from '@/components/common/avatar'
import { SafeImage } from '@/components/common/safe-image'
import { Skeleton } from '@/components/ui/skeleton'
import { ViewIcon } from '@/contexts/theme-context'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { stripInlineMarkdown } from '@/utils/common/inline-markdown'
import { getPostUrl } from '@/utils/common/route'
import { usePostCard } from './use-post-cards'

const CARD_CLASS = 'flex h-full gap-4 overflow-hidden rounded-xl border bg-card p-4 transition-colors'

/**
 * 正文中的文章引用卡片：整卡链接到被引用文章
 * 标题、摘要与封面按文章 id 实时读取（同一页面的卡片合并成一次请求），
 * 被引用文章改为私密、删除或不存在时显示「内容不可访问」；窄卡片收起封面与阅读数
 */
export default function PostRefCard({ postId, showCover }: PostRefProps) {
  const t = useTranslations('ContentComponents.postRef')
  const commonT = useTranslations()
  const format = useFormatter()
  const state = usePostCard(postId)

  if (state.status === 'loading') {
    return (
      <div className={CARD_CLASS}>
        <div className="grid flex-1 content-start gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-3/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    )
  }

  // 加载失败与不可访问（私密、已删除、id 不存在）都只显示占位，不泄露任何文章信息
  if (state.status === 'error' || !state.card) {
    return (
      <div className="flex h-full items-center gap-2.5 rounded-xl border border-dashed bg-muted/30 px-4 py-3.5 text-sm text-muted-foreground">
        <LinkIcon className="size-4 shrink-0" aria-hidden />
        <span>{state.status === 'error' ? t('load_failed') : t('unavailable')}</span>
      </div>
    )
  }

  const card = state.card
  const summary = stripInlineMarkdown(card.description)
  const author = card.user?.nickname || card.user?.username || commonT('Common.unknown_author')

  return (
    <Link
      href={getPostUrl({ post: card })}
      className={cn(CARD_CLASS, 'group no-underline hover:border-primary/40')}
    >
      {showCover && card.cover && (
        // 33% 宽度的窄卡片收起封面（组件根的 @container）
        <div className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-lg bg-muted @max-sm:hidden">
          <SafeImage src={card.cover} alt="" fill sizes="112px" className="object-cover" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <FileTextIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="shrink-0">{t('label')}</span>
          {card.category && (
            <span className="truncate">
              ·
              {card.category.name}
            </span>
          )}
        </span>
        <span className="line-clamp-2 font-semibold text-foreground transition-colors group-hover:text-primary">
          {card.title || t('untitled')}
        </span>
        {summary && <p className="line-clamp-2 text-sm text-muted-foreground">{summary}</p>}
        <div className="mt-auto flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
          <UserAvatar user={card.user} size={40} className="size-5 shrink-0" />
          <span className="truncate">{author}</span>
          <span aria-hidden>·</span>
          <time className="shrink-0" dateTime={card.createdAt}>
            {format.dateTime(new Date(card.createdAt), { year: 'numeric', month: '2-digit', day: '2-digit' })}
          </time>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 @max-2xs:hidden">
            <ViewIcon className="size-3.5" aria-hidden />
            <span className="sr-only">{t('views')}</span>
            {format.number(card.viewCount, { notation: 'compact', maximumFractionDigits: 1 })}
          </span>
        </div>
      </div>
    </Link>
  )
}
