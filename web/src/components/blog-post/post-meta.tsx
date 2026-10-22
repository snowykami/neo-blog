import type { LucideIcon } from 'lucide-react'
import type { Post } from '@/models/post'
import {
  CalendarClockIcon,
  CalendarDaysIcon,
  ClockIcon,
  EyeIcon,
  FileTextIcon,
  FolderIcon,
  HashIcon,
  HeartIcon,
  MessageCircleIcon,
  PenLineIcon,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import { getCategoryUrl, getLabelUrl, getUserUrl } from '@/utils/common/route'

/*
 * 文章元信息（参考 Fuwari 的 PostMetadata，MIT License, saicaca/fuwari）
 * 不使用客户端专属能力：next-intl 的 useTranslations / useFormatter 在服务端组件与客户端组件中都可用，
 * 因此首页列表（客户端）与文章页（服务端）共用同一套实现
 */

// 元信息中的链接：位于整卡链接（stretched link）之上，需提升层级
const metaLinkClass = 'relative z-10 rounded-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** 图标块 + 文本的元信息项；label 仅供读屏 */
export function PostMetaItem({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: LucideIcon
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-center', className)}>
      <span aria-hidden className="mr-2 flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
        <Icon className="size-4" />
      </span>
      <span className="sr-only">{label}</span>
      <div className="min-w-0 text-sm font-medium text-foreground/50">{children}</div>
    </div>
  )
}

const DATE_FORMAT = { year: 'numeric', month: '2-digit', day: '2-digit' } as const

export function PostMeta({
  post,
  showAuthor = false,
  showUpdated = false,
  showStats = false,
  className,
}: {
  post: Post
  /** 显示作者（文章页） */
  showAuthor?: boolean
  /** 更新时间与发布时间不在同一天时额外显示更新时间（文章页） */
  showUpdated?: boolean
  /** 显示浏览 / 点赞 / 评论数（文章页） */
  showStats?: boolean
  className?: string
}) {
  const t = useTranslations()
  const format = useFormatter()
  const labels = post.labels ?? []
  const created = post.createdAt ? new Date(post.createdAt) : null
  const updated = post.updatedAt ? new Date(post.updatedAt) : null
  const createdText = created ? format.dateTime(created, DATE_FORMAT) : ''
  const updatedText = updated ? format.dateTime(updated, DATE_FORMAT) : ''

  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      {showAuthor && (
        <PostMetaItem icon={PenLineIcon} label={t('Copyright.author')}>
          <Link href={getUserUrl(post.user)} className={cn(metaLinkClass, 'block max-w-[16ch] truncate')}>
            {post.user.nickname || post.user.username || t('Common.unknown_author')}
          </Link>
        </PostMetaItem>
      )}
      {created && (
        <PostMetaItem icon={CalendarDaysIcon} label={t('Copyright.post_at')}>
          <time dateTime={post.createdAt} className="tabular-nums">{createdText}</time>
        </PostMetaItem>
      )}
      {showUpdated && updated && updatedText !== createdText && (
        <PostMetaItem icon={CalendarClockIcon} label={t('Common.updated_at')}>
          <time dateTime={post.updatedAt} className="tabular-nums" title={t('Common.updated_at')}>{updatedText}</time>
        </PostMetaItem>
      )}
      <PostMetaItem icon={FolderIcon} label={t('Route.category')}>
        {post.category
          ? (
              <Link href={getCategoryUrl(post.category)} className={metaLinkClass}>
                {post.category.name}
              </Link>
            )
          : t('Common.uncategorized')}
      </PostMetaItem>
      {labels.length > 0 && (
        <PostMetaItem icon={HashIcon} label={t('Route.label')}>
          {/* 多个标签用 / 分隔 */}
          <span className="flex flex-wrap items-center">
            {labels.map((label, index) => (
              <Fragment key={label.id}>
                {index > 0 && <span aria-hidden className="mx-1.5 text-foreground/30">/</span>}
                <Link href={getLabelUrl(label)} className={metaLinkClass}>
                  {label.name}
                </Link>
              </Fragment>
            ))}
          </span>
        </PostMetaItem>
      )}
      {showStats && (
        <>
          <PostMetaItem icon={EyeIcon} label={t('Metrics.view_count')}>
            <span className="tabular-nums">{post.viewCount || 0}</span>
          </PostMetaItem>
          <PostMetaItem icon={HeartIcon} label={t('Metrics.like_count')}>
            <span className="tabular-nums">{post.likeCount || 0}</span>
          </PostMetaItem>
          <PostMetaItem icon={MessageCircleIcon} label={t('Metrics.comment_count')}>
            <span className="tabular-nums">{post.commentCount || 0}</span>
          </PostMetaItem>
        </>
      )}
    </div>
  )
}

/**
 * 字数与阅读时长：列表中为浅色纯文本，文章页（withIcons）带小图标块
 */
export function PostWordStats({
  words,
  minutes,
  withIcons = false,
  className,
  children,
}: {
  words: number
  minutes: number
  withIcons?: boolean
  className?: string
  /** 追加在后面的其他统计（如列表中的点赞 / 评论 / 浏览） */
  children?: React.ReactNode
}) {
  const t = useTranslations('Common')
  const items = [
    { icon: FileTextIcon, text: t('word_count', { count: words }) },
    { icon: ClockIcon, text: t('reading_time', { count: minutes }) },
  ]
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground/30 tabular-nums', withIcons && 'gap-x-5', className)}>
      {items.map(item => (
        <div key={item.text} className="flex items-center">
          {withIcons && (
            <span aria-hidden className="mr-2 flex size-6 items-center justify-center rounded-md bg-foreground/5 text-foreground/50">
              <item.icon className="size-3.5" />
            </span>
          )}
          {item.text}
        </div>
      ))}
      {children}
    </div>
  )
}
