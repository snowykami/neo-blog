'use client'

import type { Post } from '@/models/post'
import { ChevronRightIcon, FileSearchIcon, RotateCwIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { memo } from 'react'
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
// overflow-clip + contain:content 裁剪内嵌圆角元素并把单卡样式/布局/重绘隔离在卡片边界内（不影响外侧 surface-card 投影，且不创建 PaintLayerScrollableArea）
const ITEM_CLASS = 'surface-card overflow-clip rounded-2xl bg-card [contain:content]'
// 首页置顶文章：使用预计算的极淡主题色底色 token，避免每张卡片重算 color-mix()
const PINNED_ITEM_CLASS = 'surface-card overflow-clip rounded-2xl bg-(--card-pinned) [contain:content]'

// 搜索结果里命中的关键词：淡主色底，文字颜色不变（标题悬停变主色时仍可读）
function Highlighted({ text, terms }: { text: string, terms?: string[] }) {
  if (!terms?.length)
    return text
  return splitHighlight(text, terms).map((part, index) => part.match
    // 片段由同一段文本按顺序切出，用下标作 key 即可
    ? <mark key={index} className="rounded-sm bg-(--primary-soft) text-inherit">{part.text}</mark>
    : part.text)
}

interface PostListItemInnerProps {
  post: Post
  showAuthor: boolean
  pinned: boolean
  highlight?: string[]
  priority: boolean
  likeEnabled: boolean
  commentEnabled: boolean
}

const MemoPostListItem = memo(({
  post,
  showAuthor,
  pinned,
  highlight,
  priority,
  likeEnabled,
  commentEnabled,
}: PostListItemInnerProps) => {
  const t = useTranslations()
  const url = getPostUrl({ post })
  const hasCover = !!post.cover
  // 搜索命中了正文片段时优先展示裁剪片段，否则按作者描述 → 后端纯文本摘要 → 前端兜底提取展示
  const summary = post.searchSnippet || stripInlineMarkdown(post.description) || post.excerpt || (post.content ? htmlToText(post.content).slice(0, 200) : '')
  const effectiveHighlight = post.highlightTerms?.length
    ? Array.from(new Set([...(highlight ?? []), ...post.highlightTerms]))
    : highlight

  return (
    // 单一主链接 + 纯前向兄弟选择器架构：
    // 1. 仅标题内挂载一个 Next.js <Link>，保持 <h2> 为 static 定位使其 ::after 铺满整个 <article>（z-0）；
    // 2. PostMeta 内的作者/分类/标签链接带 relative z-10 浮于 ::after 之上，悬停子链接时不会命中主链接；
    // 3. <h2> 作为 post-title-peer 置于右侧封面/进入色块之前，走精确类名 ~ 兄弟选择器驱动反馈，彻底消除父级 :has() 回溯重算
    <article
      className={cn(
        'relative flex flex-col px-5 pt-5 pb-4 md:pt-6 md:pb-5 md:pl-9',
        hasCover ? 'md:pr-[calc(28%+2.75rem)]' : 'md:pr-[5.5rem]',
      )}
    >
      {/* 前台列表只有公开文章（私密文章只在后台可见），只需要置顶徽标 */}
      {pinned && (
        <div className="pointer-events-none mb-2 flex flex-wrap gap-2">
          <Badge variant="secondary" className="rounded-md bg-(--primary-soft) text-primary">
            <PinnedIcon />
            {t('Common.pinned')}
          </Badge>
        </div>
      )}

      {/* 标题：桌面端左侧主色竖条采用脱离文档流的 static-position 绝对定位（h2 保持 static 定位），避免长连续词在行内块后断行孤立竖条，且仅用 opacity 过渡箭头 */}
      <h2 className="post-title-peer mb-3 text-xl leading-snug font-bold tracking-tight wrap-break-word text-card-foreground before:pointer-events-none before:absolute before:mt-1.5 before:-ml-4.5 before:hidden before:h-5 before:w-1 before:rounded-md before:bg-primary md:text-2xl md:leading-8 md:before:block">
        <Link
          href={url}
          className="group/link rounded-sm transition-colors duration-150 outline-none after:absolute after:inset-0 after:z-0 after:rounded-2xl hover:text-primary focus-visible:text-primary focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset active:text-(--primary-active)"
        >
          <Highlighted text={post.title} terms={effectiveHighlight} />
          <ChevronRightIcon
            aria-hidden
            className="ml-0.5 inline-block size-5 align-[-0.18em] text-primary md:ml-1 md:size-6 md:opacity-0 md:transition-opacity md:duration-150 md:group-hover/link:opacity-100 md:group-focus-visible/link:opacity-100"
          />
        </Link>
      </h2>

      {/* 元信息：柔和底色图标块 + 分类/标签药丸热区 */}
      <PostMeta post={post} showAuthor={showAuthor} authorAvatar maxLabels={4} className="mb-3" />

      {summary && (
        // 最多 2 行，建立「标题 → 色块元信息 → 摘要 → 轻指标」四拍扫读节奏；max-h 兜底
        // 关闭 text-autospace：Safari 默认开启而 Chrome 不开启，保持一致，也避免其影响截断
        <p className="mb-3 line-clamp-2 max-h-[2lh] pr-2 text-sm leading-relaxed text-(--post-summary-fg) [text-autospace:no-autospace]">
          <Highlighted text={summary} terms={effectiveHighlight} />
        </p>
      )}

      {/* 底部轻指标行：收敛至全站统一的 text-muted-foreground + text-xs，靠字号与字重建立第四级节奏并满足 WCAG AA 对比度 */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <span className="inline-flex items-center gap-1">
          <ViewIcon className="size-3.5" />
          <span className="sr-only">{t('Metrics.view_count')}</span>
          {post.viewCount || 0}
        </span>
        {likeEnabled && (
          <>
            <span aria-hidden className="text-border">|</span>
            <span className="inline-flex items-center gap-1">
              <LikeIcon className="size-3.5" />
              <span className="sr-only">{t('Metrics.like_count')}</span>
              {post.likeCount || 0}
            </span>
          </>
        )}
        {commentEnabled && (
          <>
            <span aria-hidden className="text-border">|</span>
            <span className="inline-flex items-center gap-1">
              <CommentIcon className="size-3.5" />
              <span className="sr-only">{t('Metrics.comment_count')}</span>
              {post.commentCount || 0}
            </span>
          </>
        )}
      </div>

      {/* 右侧视觉槽位：DOM 排在 post-title-peer 之后以使用 ~ 兄弟选择器；移动端封面通过 -order-1 保持置顶 */}
      {hasCover
        ? (
            <div
              aria-hidden
              className="post-cover-slot pointer-events-none relative -order-1 -mx-1.5 -mt-1.5 mb-4.5 h-[19svh] min-h-32 overflow-clip rounded-xl md:absolute md:inset-y-3.5 md:right-3.5 md:order-0 md:m-0 md:h-auto md:min-h-0 md:w-[28%]"
            >
              <SafeImage
                src={post.cover}
                alt=""
                fill
                quality={60}
                className="object-cover"
                sizes="(max-width: 767px) calc(100vw - 52px), 280px"
                preload={priority}
                loading={priority ? 'eager' : undefined}
                fetchPriority={priority ? 'high' : undefined}
              />
              <span className="post-cover-overlay absolute inset-0 flex items-center justify-center">
                <ChevronRightIcon className="size-10 text-white" />
              </span>
            </div>
          )
        : (
            <div
              aria-hidden
              className="post-enter-slot pointer-events-none hidden items-center justify-center rounded-xl bg-secondary text-secondary-foreground transition-colors duration-150 md:absolute md:inset-y-3.5 md:right-3.5 md:flex md:w-[3.25rem]"
            >
              <ChevronRightIcon className="size-7" />
            </div>
          )}
    </article>
  )
})

/**
 * pinned：作为首页置顶文章显示（带置顶徽标）；文章在其他列表里按正常顺序出现时不显示
 * highlight：搜索结果中要高亮的关键词（标题与摘要）
 * priority：首屏第一张封面图（手机上在卡片顶部，常是最大内容绘制的元素）：预加载、高优先级、不懒加载
 */
export function PostListItem({ post, showAuthor = true, pinned = false, highlight, priority = false }: { post: Post, showAuthor?: boolean, pinned?: boolean, highlight?: string[], priority?: boolean }) {
  const { siteInfo } = useSiteInfo()
  return (
    <MemoPostListItem
      post={post}
      showAuthor={showAuthor}
      pinned={pinned}
      highlight={highlight}
      priority={priority}
      likeEnabled={isLikeEnabled(siteInfo)}
      commentEnabled={isCommentEnabled(siteInfo)}
    />
  )
}

export function PostListItemSkeleton({ showAuthor = true }: { showAuthor?: boolean }) {
  return (
    <div className="relative animate-pulse px-5 pt-5 pb-4 md:pt-6 md:pr-[5.5rem] md:pb-5 md:pl-9">
      <Skeleton className="mb-3 h-7 w-3/5 animate-none md:h-8" />
      <div className="mb-3 flex flex-wrap items-center gap-3.5">
        {showAuthor && (
          <div className="flex items-center gap-2">
            <Skeleton className="size-7 animate-none rounded-full" />
            <Skeleton className="h-4 w-16 animate-none" />
          </div>
        )}
        <div className="flex items-center gap-2">
          <Skeleton className="size-7 animate-none rounded-lg" />
          <Skeleton className="h-4 w-20 animate-none" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="size-7 animate-none rounded-lg" />
          <Skeleton className="h-4 w-16 animate-none" />
        </div>
      </div>
      <Skeleton className="mb-2 h-5 w-full animate-none" />
      <Skeleton className="mb-3 h-5 w-2/3 animate-none" />
      <Skeleton className="h-4 w-28 animate-none" />
      <Skeleton className="hidden animate-none rounded-xl md:absolute md:inset-y-3.5 md:right-3.5 md:block md:w-[3.25rem]" />
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
  const { siteInfo } = useSiteInfo()
  const likeEnabled = isLikeEnabled(siteInfo)
  const commentEnabled = isCommentEnabled(siteInfo)
  const cardClass = cn('surface-card overflow-clip rounded-2xl bg-card', className)

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
        <p className="text-lg font-medium text-(--post-summary-fg)">{t('load_failed')}</p>
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
        <p className="text-lg font-medium text-(--post-summary-fg)">{t('no_posts')}</p>
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

  // 首屏前两张卡片内出现的第一张封面图设为 LCP 优先加载（避免首篇无封面时白白浪费高优先级预加载）
  const priorityPostId = prioritizeFirst
    ? [...pinnedPosts, ...posts].slice(0, 2).find(p => p.cover)?.id
    : undefined

  return (
    <div className={cn(LIST_CLASS, className)}>
      {pinnedPosts.map(post => (
        <div key={post.id} className={PINNED_ITEM_CLASS}>
          <MemoPostListItem
            post={post}
            showAuthor={showAuthor}
            pinned
            highlight={highlight}
            priority={post.id === priorityPostId}
            likeEnabled={likeEnabled}
            commentEnabled={commentEnabled}
          />
        </div>
      ))}
      {pinnedPosts.length > 0 && posts.length > 0 && (
        <div className="flex items-center gap-3 px-2 py-0.5 text-xs font-medium text-muted-foreground after:flex-1 after:border-t after:border-dashed after:border-border">
          {listLabel}
        </div>
      )}
      {posts.map(post => (
        <div key={post.id} className={ITEM_CLASS}>
          <MemoPostListItem
            post={post}
            showAuthor={showAuthor}
            pinned={false}
            highlight={highlight}
            priority={post.id === priorityPostId}
            likeEnabled={likeEnabled}
            commentEnabled={commentEnabled}
          />
        </div>
      ))}
    </div>
  )
}
