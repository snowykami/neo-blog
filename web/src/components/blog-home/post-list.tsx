'use client'

import type { Post } from '@/models/post'
import { ChevronRightIcon, FileSearchIcon, RotateCwIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { PostMeta } from '@/components/blog-post/post-meta'
import { SafeImage } from '@/components/common/safe-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSiteInfo } from '@/contexts/site-info-context'
import { CommentIcon, LikeIcon, PinnedIcon, ViewIcon } from '@/contexts/theme-context'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { splitHighlight } from '@/utils/common/highlight'
import { stripInlineMarkdown } from '@/utils/common/inline-markdown'
import { getPostUrl } from '@/utils/common/route'
import { isCommentEnabled, isLikeEnabled } from '@/utils/common/siteinfo'
import { htmlToText } from '@/utils/common/string'

/*
 * 文章列表（首页、分类、用户主页共用），参考 Fuwari 的 PostCard（MIT License, saicaca/fuwari）
 * 每篇文章均为独立圆角卡片，卡片间距透出带主题色倾向的页面底色；
 * 桌面端有封面时右侧内嵌缩略图，无封面时右侧展示柔和色块进入按钮；移动端有封面时置顶展示
 */

const LIST_CLASS = 'grid gap-3.5 md:gap-4'
const ITEM_CLASS = 'surface-card overflow-hidden rounded-2xl bg-card'
// 首页置顶文章：在独立卡片底色中混入极淡主题色以示区分
const PINNED_ITEM_CLASS = 'surface-card overflow-hidden rounded-2xl bg-[color-mix(in_oklch,var(--primary)_4%,var(--card))]'

// 搜索结果里命中的关键词：淡主色底，文字颜色不变（标题悬停变主色时仍可读）
function Highlighted({ text, terms }: { text: string, terms?: string[] }) {
  if (!terms?.length)
    return text
  return splitHighlight(text, terms).map((part, index) => part.match
    // 片段由同一段文本按顺序切出，用下标作 key 即可
    ? <mark key={index} className="rounded-sm bg-primary/15 text-inherit">{part.text}</mark>
    : part.text)
}

/**
 * pinned：作为首页置顶文章显示（带置顶徽标）；文章在其他列表里按正常顺序出现时不显示
 * highlight：搜索结果中要高亮的关键词（标题与摘要）
 * priority：首屏第一篇的封面（手机上在卡片顶部，常是最大内容绘制的元素）：预加载、高优先级、不懒加载
 */
export function PostListItem({ post, showAuthor = true, pinned = false, highlight, priority = false }: { post: Post, showAuthor?: boolean, pinned?: boolean, highlight?: string[], priority?: boolean }) {
  const t = useTranslations()
  const { siteInfo } = useSiteInfo()
  const likeEnabled = isLikeEnabled(siteInfo)
  const commentEnabled = isCommentEnabled(siteInfo)
  const url = getPostUrl({ post })
  const hasCover = !!post.cover
  // 搜索命中了正文片段时优先展示裁剪片段，否则按作者描述 → 后端纯文本摘要 → 前端兜底提取展示
  const summary = post.searchSnippet || stripInlineMarkdown(post.description) || post.excerpt || htmlToText(post.content || '').slice(0, 200)
  const effectiveHighlight = post.highlightTerms?.length
    ? Array.from(new Set([...(highlight ?? []), ...post.highlightTerms]))
    : highlight

  return (
    // 单一主链接架构：仅标题内挂载一个 Next.js <Link> 并以伪元素铺满整卡（减少重复 IntersectionObserver）；
    // 右侧封面 / 进入按钮设为 pointer-events-none，配合 data-post-link 让悬停分类/标签子链接（z-10）时不误亮整卡反馈
    <article className="group relative flex flex-col-reverse md:flex-col">
      <div
        className={cn(
          'relative px-5 pt-5 pb-4 md:pt-6 md:pr-4 md:pb-5 md:pl-9',
          hasCover ? 'md:w-[calc(72%-0.75rem)]' : 'md:w-[calc(100%-3.25rem-0.75rem)]',
        )}
      >
        {/* 前台列表只有公开文章（私密文章只在后台可见），只需要置顶徽标 */}
        {pinned && (
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge variant="secondary" className="rounded-md bg-primary/12 text-primary">
              <PinnedIcon />
              {t('Common.pinned')}
            </Badge>
          </div>
        )}

        {/* 标题：桌面端左侧附带与正文同风格的主色圆角竖条，悬停时右侧滑出主色箭头 */}
        <h2 className="relative mb-3 text-xl leading-snug font-bold tracking-tight text-foreground/90 [text-wrap:balance] before:pointer-events-none before:absolute before:top-1.5 before:-left-[18px] before:hidden before:h-5 before:w-1 before:rounded-md before:bg-primary md:text-2xl md:leading-8 md:before:block">
          <Link
            href={url}
            data-post-link=""
            className="group/link rounded-sm transition-colors duration-150 outline-none after:absolute after:inset-0 after:z-0 after:rounded-2xl hover:text-primary active:text-primary/80 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          >
            <Highlighted text={post.title} terms={effectiveHighlight} />
            <ChevronRightIcon
              aria-hidden
              className="ml-0.5 inline-block size-5 translate-y-[-0.06em] text-primary md:ml-1 md:size-6 md:-translate-x-1.5 md:opacity-0 md:transition-[opacity,transform] md:duration-150 md:group-hover/link:translate-x-0 md:group-hover/link:opacity-100"
            />
          </Link>
        </h2>

        {/* 元信息：柔和底色图标块 + 分类/标签药丸热区 */}
        <PostMeta post={post} showAuthor={showAuthor} authorAvatar maxLabels={4} className="mb-3" />

        {summary && (
          // 最多 2 行，建立「标题 → 色块元信息 → 摘要 → 轻指标」四拍扫读节奏；max-h 兜底
          // 关闭 text-autospace：Safari 默认开启而 Chrome 不开启，保持一致，也避免其影响截断
          <p className="mb-3 line-clamp-2 max-h-[2lh] pr-2 text-sm leading-relaxed text-foreground/75 md:text-[0.9375rem] [text-autospace:no-autospace]">
            <Highlighted text={summary} terms={effectiveHighlight} />
          </p>
        )}

        {/* 底部轻指标行：与 Fuwari 字数栏同位置，复用已有列表字段而不额外拉取全文 */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-foreground/45 tabular-nums">
          <span className="inline-flex items-center gap-1" title={t('Metrics.view_count')}>
            <ViewIcon className="size-3.5" />
            <span className="sr-only">{t('Metrics.view_count')}</span>
            {post.viewCount || 0}
          </span>
          {likeEnabled && (
            <>
              <span aria-hidden className="text-foreground/20">|</span>
              <span className="inline-flex items-center gap-1" title={t('Metrics.like_count')}>
                <LikeIcon className="size-3.5" />
                <span className="sr-only">{t('Metrics.like_count')}</span>
                {post.likeCount || 0}
              </span>
            </>
          )}
          {commentEnabled && (
            <>
              <span aria-hidden className="text-foreground/20">|</span>
              <span className="inline-flex items-center gap-1" title={t('Metrics.comment_count')}>
                <CommentIcon className="size-3.5" />
                <span className="sr-only">{t('Metrics.comment_count')}</span>
                {post.commentCount || 0}
              </span>
            </>
          )}
        </div>
      </div>

      {/* 右侧视觉槽位：有封面时展示圆角缩略图，无封面时桌面端展示 Fuwari 同款纵向进入色块 */}
      {hasCover
        ? (
            <div
              aria-hidden
              className="pointer-events-none relative mx-3 mt-3 -mb-1 h-[19vh] min-h-32 overflow-hidden rounded-xl transition-transform duration-150 group-has-[[data-post-link]:active]:scale-[.98] md:absolute md:inset-y-3 md:right-3 md:m-0 md:h-auto md:w-[28%]"
            >
              <SafeImage
                src={post.cover}
                alt=""
                fill
                quality={60}
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 320px"
                preload={priority}
                loading={priority ? 'eager' : undefined}
                fetchPriority={priority ? 'high' : undefined}
              />
              <span className="absolute inset-0 z-10 bg-black/0 transition-colors duration-150 group-has-[[data-post-link]:hover]:bg-black/30" />
              <span className="absolute inset-0 z-20 flex items-center justify-center">
                <ChevronRightIcon className="size-11 scale-50 text-white opacity-0 transition-[opacity,transform] duration-150 group-has-[[data-post-link]:hover]:scale-100 group-has-[[data-post-link]:hover]:opacity-100" />
              </span>
            </div>
          )
        : (
            <div
              aria-hidden
              className="pointer-events-none hidden items-center justify-center rounded-xl bg-secondary text-secondary-foreground transition-[background-color,color,transform] duration-150 group-has-[[data-post-link]:hover]:bg-[color-mix(in_oklch,var(--primary)_14%,var(--secondary))] group-has-[[data-post-link]:hover]:text-primary group-has-[[data-post-link]:active]:scale-95 md:absolute md:inset-y-3 md:right-3 md:flex md:w-[3.25rem]"
            >
              <ChevronRightIcon className="size-7 transition-transform duration-150 group-has-[[data-post-link]:hover]:translate-x-0.5" />
            </div>
          )}
    </article>
  )
}

export function PostListItemSkeleton({ showAuthor = true }: { showAuthor?: boolean }) {
  return (
    <div className="relative">
      <div className="px-5 pt-5 pb-4 md:w-[calc(100%-3.25rem-0.75rem)] md:pt-6 md:pr-4 md:pb-5 md:pl-9">
        <Skeleton className="mb-3 h-7 w-3/5 md:h-8" />
        <div className="mb-3 flex flex-wrap items-center gap-3.5">
          {showAuthor && (
            <div className="flex items-center gap-2">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Skeleton className="size-7 rounded-lg" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="size-7 rounded-lg" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        <Skeleton className="mb-1.5 h-4 w-full" />
        <Skeleton className="mb-3 h-4 w-2/3" />
        <Skeleton className="h-3.5 w-28" />
      </div>
      <Skeleton className="hidden rounded-xl md:absolute md:inset-y-3 md:right-3 md:block md:w-[3.25rem]" />
    </div>
  )
}

/**
 * 文章列表卡片
 * - isLoading：显示与每页条数一致的骨架行
 * - error + onRetry：加载失败时显示错误态与重试
 * - onClearFilter：空列表时提供「清除筛选」操作
 * - showAuthor：显示作者头像与昵称（用户主页中均为同一作者，可关闭）
 * - highlight：搜索结果中要高亮的关键词
 * - prioritizeFirst：列表就是页面的首屏内容（首页、分类页）时，第一篇的封面按首屏大图加载
 */
export function PostList({
  posts,
  pinnedPosts = [],
  listLabel,
  showAuthor = true,
  isLoading = false,
  skeletonCount = 6,
  error = false,
  onRetry,
  onClearFilter,
  highlight,
  prioritizeFirst = false,
  className,
}: {
  posts: Post[]
  pinnedPosts?: Post[] // 首页第一页最上方的置顶文章，后面用 listLabel 隔开普通文章
  listLabel?: string
  showAuthor?: boolean
  isLoading?: boolean
  skeletonCount?: number
  error?: boolean
  onRetry?: () => void
  onClearFilter?: () => void
  highlight?: string[]
  prioritizeFirst?: boolean
  className?: string
}) {
  const t = useTranslations('BlogHome')
  const cardClass = cn('surface-card overflow-hidden rounded-2xl bg-card', className)

  if (isLoading) {
    return (
      <div className={cn(LIST_CLASS, className)} aria-busy="true">
        {Array.from({ length: Math.max(1, skeletonCount) }).map((_, index) => (
          <div key={index} className={ITEM_CLASS}><PostListItemSkeleton showAuthor={showAuthor} /></div>
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

  if (posts.length === 0 && pinnedPosts.length === 0) {
    return (
      <div className={cn(cardClass, 'flex flex-col items-center gap-2 px-6 py-14 text-center')}>
        <span aria-hidden className="mb-1 flex size-12 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
          <FileSearchIcon className="size-6" />
        </span>
        <p className="text-lg font-medium text-foreground/75">{t('no_posts')}</p>
        <p className="text-sm text-muted-foreground">
          {t('no_posts_found')}
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
    <div className={cn(LIST_CLASS, className)}>
      {pinnedPosts.map((post, index) => (
        <div key={post.id} className={PINNED_ITEM_CLASS}>
          <PostListItem post={post} showAuthor={showAuthor} pinned highlight={highlight} priority={prioritizeFirst && index === 0} />
        </div>
      ))}
      {pinnedPosts.length > 0 && posts.length > 0 && (
        <div className="flex items-center gap-3 px-2 py-0.5 text-xs font-medium text-muted-foreground after:flex-1 after:border-t after:border-dashed after:border-foreground/12">
          {listLabel}
        </div>
      )}
      {posts.map((post, index) => (
        <div key={post.id} className={ITEM_CLASS}>
          <PostListItem post={post} showAuthor={showAuthor} highlight={highlight} priority={prioritizeFirst && pinnedPosts.length === 0 && index === 0} />
        </div>
      ))}
    </div>
  )
}
