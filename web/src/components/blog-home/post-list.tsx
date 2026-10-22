'use client'

import type { Post } from '@/models/post'
import { ChevronRightIcon, EyeIcon, FileSearchIcon, HeartIcon, LockIcon, MessageCircleIcon, PinIcon, RotateCwIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Fragment } from 'react'
import { PostMeta } from '@/components/blog-post/post-meta'
import { SafeImage } from '@/components/common/safe-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { stripInlineMarkdown } from '@/utils/common/inline-markdown'
import { getPostUrl } from '@/utils/common/route'
import { htmlToText } from '@/utils/common/string'

/*
 * 文章列表（首页、分类、用户主页共用），参考 Fuwari 的 PostCard（MIT License, saicaca/fuwari）
 * 整个列表放在一张卡片内，行之间用虚线分隔；桌面端封面在右，移动端封面在上
 */

// 行与行之间的虚线，左右缩进与内容对齐
function RowDivider() {
  return <div aria-hidden className="mx-6 border-t border-dashed border-foreground/10 md:mx-8" />
}

export function PostListItem({ post, showAuthor = true }: { post: Post, showAuthor?: boolean }) {
  const t = useTranslations()
  const url = getPostUrl({ post })
  const hasCover = !!post.cover
  const summary = stripInlineMarkdown(post.description) || htmlToText(post.content || '').slice(0, 200)

  return (
    // 整行可点：标题链接的伪元素铺满整行（stretched link），分类 / 标签链接层级更高
    <article className="group relative flex flex-col-reverse md:flex-col">
      <div
        className={cn(
          'relative px-6 pt-6 pb-6 md:px-8 md:pt-7',
          hasCover && 'md:w-[calc(72%-0.75rem)] md:pr-4',
        )}
      >
        {(post.top > 0 || post.isPrivate) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {post.top > 0 && (
              <Badge variant="secondary" className="rounded-md">
                <PinIcon aria-hidden />
                {t('Common.pinned')}
              </Badge>
            )}
            {post.isPrivate && (
              <Badge variant="secondary" className="rounded-md">
                <LockIcon aria-hidden />
                {t('Common.private')}
              </Badge>
            )}
          </div>
        )}

        <h2 className="mb-3 text-2xl font-bold text-foreground/90 transition-colors duration-150 group-hover:text-primary md:text-3xl">
          <Link
            href={url}
            className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          >
            {post.title}
          </Link>
        </h2>

        <PostMeta post={post} showAuthor={showAuthor} authorAvatar className="mb-4" />

        {summary && (
          // 最多 4 行，超出显示省略号；max-h 兜底：浏览器忽略 line-clamp 时也只露出 4 行
          // 关闭 text-autospace：Safari 默认开启而 Chrome 不开启，保持一致，也避免其影响截断
          <p className="mb-3.5 line-clamp-4 max-h-[4lh] text-foreground/75 [text-autospace:no-autospace]">{summary}</p>
        )}

        {/* 列表正文已被接口截断，字数 / 阅读时长只在文章页按完整正文展示 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground/30 tabular-nums">
          <span className="flex items-center gap-1" title={t('Metrics.like_count')}>
            <HeartIcon aria-hidden className="size-3.5" />
            <span className="sr-only">{t('Metrics.like_count')}</span>
            {post.likeCount || 0}
          </span>
          <span className="flex items-center gap-1" title={t('Metrics.comment_count')}>
            <MessageCircleIcon aria-hidden className="size-3.5" />
            <span className="sr-only">{t('Metrics.comment_count')}</span>
            {post.commentCount || 0}
          </span>
          <span className="flex items-center gap-1" title={t('Metrics.view_count')}>
            <EyeIcon aria-hidden className="size-3.5" />
            <span className="sr-only">{t('Metrics.view_count')}</span>
            {post.viewCount || 0}
          </span>
        </div>
      </div>

      {/* 封面：无封面时不显示；独立链接仅供鼠标点击，键盘焦点交给标题链接 */}
      {hasCover && (
        <Link
          href={url}
          tabIndex={-1}
          aria-hidden
          className="group/cover relative mx-4 mt-4 -mb-2 block h-[20vh] min-h-32 overflow-hidden rounded-xl transition-transform duration-150 active:scale-[.97] md:absolute md:inset-y-3 md:right-3 md:m-0 md:h-auto md:w-[28%]"
        >
          <SafeImage
            src={post.cover}
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 320px"
          />
          {/* 悬停遮罩 + 箭头 */}
          <span className="pointer-events-none absolute inset-0 z-10 bg-black/0 transition-colors duration-150 group-hover/cover:bg-black/30" />
          <span className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <ChevronRightIcon className="size-12 scale-50 text-white opacity-0 transition-[opacity,transform] duration-150 group-hover/cover:scale-100 group-hover/cover:opacity-100" />
          </span>
        </Link>
      )}
    </article>
  )
}

export function PostListItemSkeleton() {
  return (
    <div className="px-6 py-6 md:px-8 md:pt-7">
      <Skeleton className="mb-3 h-8 w-3/4 md:h-9" />
      <div className="mb-4 flex flex-wrap gap-4">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-32" />
      </div>
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className="mb-3.5 h-4 w-2/3" />
      <Skeleton className="h-4 w-40" />
    </div>
  )
}

/**
 * 文章列表卡片
 * - isLoading：显示与每页条数一致的骨架行
 * - error + onRetry：加载失败时显示错误态与重试
 * - onClearFilter：空列表时提供「清除筛选」操作
 * - showAuthor：显示作者头像与昵称（用户主页中均为同一作者，可关闭）
 */
export function PostList({
  posts,
  showPrivate = false,
  showAuthor = true,
  isLoading = false,
  skeletonCount = 6,
  error = false,
  onRetry,
  onClearFilter,
  className,
}: {
  posts: Post[]
  showPrivate?: boolean
  showAuthor?: boolean
  isLoading?: boolean
  skeletonCount?: number
  error?: boolean
  onRetry?: () => void
  onClearFilter?: () => void
  className?: string
}) {
  const t = useTranslations('BlogHome')
  const filteredPosts = showPrivate ? posts : posts.filter(post => !post.isPrivate)
  const cardClass = cn('overflow-hidden rounded-2xl bg-card', className)

  if (isLoading) {
    return (
      <div className={cardClass} aria-busy="true">
        {Array.from({ length: Math.max(1, skeletonCount) }).map((_, index) => (
          <Fragment key={index}>
            {index > 0 && <RowDivider />}
            <PostListItemSkeleton />
          </Fragment>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn(cardClass, 'flex flex-col items-center gap-3 px-6 py-14 text-center')} role="alert">
        <p className="text-lg font-medium text-foreground/75">{t('load_failed')}</p>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            <RotateCwIcon aria-hidden />
            {t('retry')}
          </Button>
        )}
      </div>
    )
  }

  if (filteredPosts.length === 0) {
    return (
      <div className={cn(cardClass, 'flex flex-col items-center gap-2 px-6 py-14 text-center')}>
        <span aria-hidden className="mb-1 flex size-12 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
          <FileSearchIcon className="size-6" />
        </span>
        <p className="text-lg font-medium text-foreground/75">{t('no_posts')}</p>
        <p className="text-sm text-foreground/50">
          {showPrivate ? t('no_posts_found') : t('no_public_posts_found')}
        </p>
        {onClearFilter && (
          <Button variant="secondary" className="mt-2" onClick={onClearFilter}>
            <XIcon aria-hidden />
            {t('clear_filter')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className={cardClass}>
      {filteredPosts.map((post, index) => (
        <Fragment key={post.id}>
          {index > 0 && <RowDivider />}
          <PostListItem post={post} showAuthor={showAuthor} />
        </Fragment>
      ))}
    </div>
  )
}
