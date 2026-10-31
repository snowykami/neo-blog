import type { Post } from '@/models/post'
import { LockIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { AISummary } from '@/components/blog-post/ai-summary.client'
import HtmlEnhancer from '@/components/blog-post/blog-content-enhanced'
import CopyrightCard from '@/components/blog-post/blog-copyright.client'
import { BlogLikeButton } from '@/components/blog-post/blog-like-button.client'
import { BlogShare } from '@/components/blog-post/blog-share.client'
import { ContentHoverCard } from '@/components/blog-post/content-hover-card'
import { ContentImageFallback } from '@/components/blog-post/content-image-fallback'
import { ContentImageViewer } from '@/components/blog-post/content-image-viewer'
import { PostEditButton } from '@/components/blog-post/post-edit-button.client'
import { PostMeta, PostStats } from '@/components/blog-post/post-meta'
import { PostToc } from '@/components/blog-post/post-toc.client'
import { BlogSidebarAbout } from '@/components/blog-sidebar/blog-sidebar-card'
import { CommentSection } from '@/components/comment'
import { SafeImage } from '@/components/common/safe-image'
import { VisitReporter } from '@/components/common/visit-reporter'
import { ComponentIslands } from '@/components/content-components/component-islands'
import { SiteShell } from '@/components/layout/site-shell'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PinnedIcon } from '@/contexts/theme-context'
import { TargetType } from '@/models/types'
import { calculateReadingTime, countWords } from '@/utils/common/post'
import { renderContentHtml } from '@/utils/server/render-content'
import '@/components/tiptap-node/image-node/image-figure.scss'
import './blog-post-article.scss'

/*
 * 文章页（参考 Fuwari 的 PostPage，MIT License, saicaca/fuwari）：
 * 正文卡片内依次为 字数/阅读时长 → 标题（左侧主色短色条）→ 元信息 → 封面 → 摘要 → 正文 → 版权 → 点赞；评论单独一张卡片
 */

// 正文卡片：标题、元信息、封面、正文、版权与点赞
async function PostArticle({ post, html, isDraft }: { post: Post, html: string, isDraft?: boolean }) {
  const t = await getTranslations('Common')
  const content = (isDraft ? post.draftContent : post.content) || ''
  return (
    <div className="rounded-2xl bg-card px-6 pt-6 pb-8 md:px-9">
      <PostStats withIcons words={countWords(content)} minutes={calculateReadingTime(content)} views={post.viewCount || 0} likes={post.likeCount || 0} comments={post.commentCount || 0} className="mb-3" />

      {(post.top > 0 || post.isPrivate) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {post.top > 0 && (
            <Badge variant="secondary" className="rounded-md">
              <PinnedIcon />
              {t('pinned')}
            </Badge>
          )}
          {post.isPrivate && (
            <Badge variant="secondary" className="rounded-md">
              <LockIcon aria-hidden />
              {t('private')}
            </Badge>
          )}
        </div>
      )}

      {/* 标题：桌面端左侧主色短色条位于卡片内边距中 */}
      <h1 className="relative mb-3 text-3xl font-bold text-foreground/90 md:text-[2.25rem] md:leading-[2.75rem] md:before:absolute md:before:top-[0.875rem] md:before:-left-[1.125rem] md:before:h-4 md:before:w-1 md:before:rounded-md md:before:bg-primary">
        {post.title}
      </h1>

      <div className="mb-5 flex items-start justify-between gap-3 border-b border-dashed border-foreground/10 pb-5">
        <PostMeta post={post} showAuthor showUpdated />
        <PostEditButton post={post} />
      </div>

      {/* 封面：仅在设置了封面时显示，不使用随机默认封面占位 */}
      {post.cover && (
        <div className="relative mb-8 aspect-[2/1] w-full overflow-hidden rounded-xl bg-muted">
          <SafeImage
            src={post.cover}
            alt=""
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 860px"
            className="object-cover"
          />
        </div>
      )}

      {/* 摘要：AI 生成的摘要以卡片 + 打字机效果展示，手写描述保持原样式 */}
      {post.description && (post.descriptionByAi
        ? <AISummary text={post.description} label={t('ai_summary')} className="mb-6" />
        : <p className="mb-6 text-foreground/75">{post.description}</p>)}

      {/* 文章内容 - Core content rendered immediately */}
      <article
        id="blog-content"
        className="prose max-w-none dark:prose-invert pangu-autospace"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <HtmlEnhancer containerId="blog-content" />
      {/* 正文中的组件块：按注册表懒加载并挂载为交互组件 */}
      <ComponentIslands containerId="blog-content" />
      {/* 草稿预览不计入访客记录 */}
      {!isDraft && <VisitReporter targetType="post" targetId={post.id} />}
      <ContentHoverCard containerId="blog-content" />
      <ContentImageFallback containerId="blog-content" />
      <ContentImageViewer containerId="blog-content" />

      <CopyrightCard post={post} className="mt-8" />

      {/* 点赞与分享 - Wrapped in Suspense for better performance */}
      <div className="mt-8">
        <Suspense fallback={<LikeButtonSkeleton />}>
          <BlogLikeButton post={post} />
        </Suspense>
        {/* 草稿预览不对外分享 */}
        {!isDraft && (
          <div className="mt-6 flex justify-center">
            <BlogShare post={post} />
          </div>
        )}
      </div>
    </div>
  )
}

// Skeleton for like button
function LikeButtonSkeleton() {
  return (
    <div className="flex flex-col items-center gap-3">
      <Skeleton className="h-11 w-24 rounded-lg" />
      <Skeleton className="h-5 w-32" />
    </div>
  )
}

// Skeleton for comments section
const COMMENT_SKELETON_ITEMS = Array.from({ length: 2 })
function CommentsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48 mb-6" />
      {COMMENT_SKELETON_ITEMS.map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="w-10 h-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

export async function BlogPost({ post, isDraft = false }: { post: Post, isDraft?: boolean }) {
  const { html, headings } = renderContentHtml((isDraft ? post.draftContent : post.content) || '<h1>No Content</h1>')
  return (
    <SiteShell
      stickySidebar={false}
      sidebar={(
        // 侧栏与正文等高，只让目录吸顶
        <div className="flex h-full flex-col gap-4">
          <BlogSidebarAbout />
          <PostToc
            headings={headings}
            className="hidden lg:sticky lg:top-[calc(var(--nav-h)+1rem)] lg:block"
          />
        </div>
      )}
    >
      <PostArticle post={post} html={html} isDraft={isDraft} />
      {/* Comments section wrapped in Suspense for better performance */}
      <div className="rounded-2xl bg-card px-6 py-6 md:px-9 md:py-8">
        <Suspense fallback={<CommentsSkeleton />}>
          <CommentSection
            targetType={TargetType.Post}
            ownerId={post.user.id}
            targetId={post.id}
            totalCount={post.commentCount}
          />
        </Suspense>
      </div>
    </SiteShell>
  )
}
