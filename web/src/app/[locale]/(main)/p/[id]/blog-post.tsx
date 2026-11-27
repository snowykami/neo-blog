import type { Post } from '@/models/post'
import { LockIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { getCachedSiteInfo } from '@/api/misc.server'
import { AISummary } from '@/components/blog-post/ai-summary.client'
import HtmlEnhancer from '@/components/blog-post/blog-content-enhanced'
import CopyrightCard from '@/components/blog-post/blog-copyright.client'
import { BlogLikeButton } from '@/components/blog-post/blog-like-button.client'
import { BlogShare } from '@/components/blog-post/blog-share.client'
import { ContentFontLinks } from '@/components/blog-post/content-font-links'
import { ContentHdrText } from '@/components/blog-post/content-hdr-text'
import { ContentHoverCard } from '@/components/blog-post/content-hover-card'
import { ContentImageFallback } from '@/components/blog-post/content-image-fallback'
import { ContentImageViewer } from '@/components/blog-post/content-image-viewer-lazy'
import { PostActivityTracker, PostHeavySubtree } from '@/components/blog-post/post-activity-guard'
import { PostBackground } from '@/components/blog-post/post-background.client'
import { PostContinuation } from '@/components/blog-post/post-continuation'
import { PostEditButton } from '@/components/blog-post/post-edit-button.client'
import { PostLiveStats } from '@/components/blog-post/post-live-stats.client'
import { PostMeta } from '@/components/blog-post/post-meta'
import { PostToc } from '@/components/blog-post/post-toc.client'
import { BlogSidebarAbout } from '@/components/blog-sidebar/blog-sidebar-card'
import { DeferredCommentSection } from '@/components/comment/deferred-comment-section'
import { LinkPreviewScopeProvider } from '@/components/common/link-preview-context'
import { SafeImage } from '@/components/common/safe-image'
import { VisitReporter } from '@/components/common/visit-reporter'
import { ComponentIslands } from '@/components/content-components/component-islands'
import { SiteShell } from '@/components/layout/site-shell'
import { ReadingIsland } from '@/components/layout/topbar-island/reading-island'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PinnedIcon } from '@/contexts/theme-context'
import { contentWebFonts, resolveContentTheme } from '@/lib/content-theme'
import { TargetType } from '@/models/types'
import { calculateReadingTime, countWords } from '@/utils/common/post'
import { isCommentEnabled, isLikeEnabled } from '@/utils/common/siteinfo'
import { renderContentHtml } from '@/utils/server/render-content'
import { getCachedPostNeighbors } from './post-data'
import '@/app/styles/prose.css'
import '@/app/styles/content-themes/index.scss'
import '@/components/tiptap-node/image-node/image-figure.scss'
import '@/components/tiptap-node/video-node/video-figure.scss'
import '@/components/tiptap-node/inline-icon-node/inline-icon.scss'
// 公式样式（约 4 KB）；KaTeX 字体只在页面用到公式时才下载
import 'katex/dist/katex.min.css'

/*
 * 文章页（参考 Fuwari 的 PostPage，MIT License, saicaca/fuwari）：
 * 正文卡片内依次为 字数/阅读时长 → 标题（左侧主色短色条）→ 元信息 → 封面 → 摘要 → 正文 → 版权 → 点赞；评论单独一张卡片
 */

// 正文卡片：标题、元信息、封面、正文、版权与点赞
async function PostArticle({ post, html, isDraft }: { post: Post, html: string, isDraft?: boolean }) {
  const t = await getTranslations('Common')
  const content = (isDraft ? post.draftContent : post.content) || ''
  // 文章未选内容主题时跟随站点默认；只加载主题与局部字体实际用到的网页字体
  const siteInfo = await getCachedSiteInfo()
  const theme = resolveContentTheme(post.contentTheme, siteInfo.contentTheme)
  const likeEnabled = isLikeEnabled(siteInfo)
  // 交给客户端组件（编辑入口、版权、点赞、分享）的只有这些字段：整篇 post 带着正文原文，传进去会在 RSC 里再发一份正文。
  // 几个组件共用同一个对象，RSC 里只序列化一次
  // 计数是页面缓存里的快照，统计行在浏览器里换成最新值（见 PostLiveStats）
  const postInfo: Pick<Post, 'id' | 'slug' | 'title' | 'description' | 'createdAt' | 'updatedAt' | 'user' | 'isLiked' | 'likeCount' | 'viewCount' | 'commentCount'> = {
    id: post.id,
    slug: post.slug,
    title: post.title,
    description: post.description,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    user: post.user,
    isLiked: post.isLiked,
    likeCount: post.likeCount,
    viewCount: post.viewCount,
    commentCount: post.commentCount,
  }
  return (
    <div className="surface-card rounded-2xl bg-card p-5 sm:p-7 md:p-8">
      <PostLiveStats post={postInfo} words={countWords(content)} minutes={calculateReadingTime(content)} className="mb-3" />

      {/* 私密徽标只会出现在后台预览里：前台接口不返回私密文章 */}
      {(post.pinned || post.isPrivate) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {post.pinned && (
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

      {/* 标题：左侧主色竖条与内容左边界、正文引用块竖条严格同轴对齐 */}
      <h1 className="relative mb-3 pl-4 text-2xl font-bold text-foreground/90 [text-wrap:balance] before:absolute before:top-[0.4375rem] before:left-0 before:h-4.5 before:w-1 before:rounded-full before:bg-primary sm:text-3xl sm:before:top-2 sm:before:h-5 md:pl-5 md:text-[2.125rem] md:leading-[2.65rem] md:before:top-[0.6375rem] md:before:h-5.5">
        {post.title}
      </h1>

      <div className="mb-5 flex items-start justify-between gap-3 border-b border-dashed border-foreground/10 pb-5">
        <PostMeta post={post} showAuthor showUpdated />
        <PostEditButton post={postInfo} />
      </div>

      {/* 封面：仅在设置了封面时显示，不使用随机默认封面占位 */}
      {post.cover && (
        <div className="relative mb-8 aspect-[2/1] w-full overflow-hidden rounded-xl bg-muted">
          <SafeImage
            src={post.cover}
            alt={post.title || t('untitled')}
            fill
            quality={60}
            preload
            loading="eager"
            fetchPriority="high"
            sizes="(max-width: 640px) calc(100vw - 64px), (max-width: 1024px) calc(100vw - 96px), 840px"
            className="object-cover"
          />
        </div>
      )}

      {/* 摘要：AI 生成的摘要以卡片 + 打字机效果展示，手写描述保持原样式 */}
      {post.description && (post.descriptionByAi
        ? <AISummary text={post.description} label={t('ai_summary')} className="mb-6" />
        : <p className="mb-6 text-foreground/75">{post.description}</p>)}

      {/* 文章内容 - 网页字体提升至 head 保活；正文多媒体、代码高亮与组件岛受客户端文章 LRU 托管，滑出最近窗口且隐藏时主动卸载释放内存 */}
      <ContentFontLinks fonts={contentWebFonts(theme, html)} />
      {/* 草稿预览不计入访客记录 */}
      {!isDraft && <VisitReporter key={post.id} targetType="post" targetId={post.id} />}
      <PostHeavySubtree postId={post.id} bypass={isDraft} preserveHeight>
        <article
          id="blog-content"
          className="content-body prose max-w-none dark:prose-invert pangu-autospace"
          data-content-theme={theme}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <HtmlEnhancer containerId="blog-content" />
        <LinkPreviewScopeProvider targetType="post" targetId={post.id}>
          {/* 正文中的组件块：按注册表懒加载并挂载为交互组件 */}
          <ComponentIslands containerId="blog-content" />
          <ContentHoverCard containerId="blog-content" />
        </LinkPreviewScopeProvider>
        <ContentImageFallback containerId="blog-content" />
        <ContentHdrText containerId="blog-content" />
        <ContentImageViewer containerId="blog-content" />
      </PostHeavySubtree>

      <CopyrightCard post={postInfo} className="mt-8" />

      {/* 点赞与分享 - Wrapped in Suspense for better performance；id 供顶栏「读完啦」提示跳转 */}
      {(likeEnabled || !isDraft) && (
        <div id="post-actions" className="mt-8">
          {likeEnabled && (
            <Suspense fallback={<LikeButtonSkeleton />}>
              <BlogLikeButton post={postInfo} />
            </Suspense>
          )}
          {/* 草稿预览不对外分享 */}
          {!isDraft && (
            <div className={likeEnabled ? 'mt-6 flex justify-center' : 'flex justify-center'}>
              <BlogShare post={postInfo} />
            </div>
          )}
        </div>
      )}
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

// isDraft：后台预览（/console/posts/preview/[id]）渲染草稿正文，不上报访问、不显示分享；前台文章页不传
export async function BlogPost({ post, isDraft = false }: { post: Post, isDraft?: boolean }) {
  const content = (isDraft ? post.draftContent : post.content) || ''
  // 正文为空时显示一句提示（用段落而不是标题，不进目录）；渲染时照常经过净化
  const emptyContent = content ? '' : `<p>${(await getTranslations('Common'))('empty_content')}</p>`
  const copyLabel = (await getTranslations('CodeBlock'))('copy')
  const [{ html, headings }, neighbors, siteInfo] = await Promise.all([
    renderContentHtml(content || emptyContent, { copyLabel }),
    isDraft ? Promise.resolve(null) : getCachedPostNeighbors(post.id),
    getCachedSiteInfo(),
  ])
  const commentEnabled = isCommentEnabled(siteInfo)
  return (
    <>
      <PostActivityTracker postId={post.id} bypass={isDraft} />
      {/* 顶栏灵动岛的阅读进度与迷你目录（随重子树同生命周期挂载，确保再激活时总在 #blog-content 提交后测量） */}
      {/* 只传点赞需要的字段，不把整篇文章再序列化一遍给客户端 */}
      <PostHeavySubtree postId={post.id} bypass={isDraft}>
        <ReadingIsland title={post.title} headings={headings} minutes={calculateReadingTime(content)} post={{ id: post.id, isLiked: post.isLiked, likeCount: post.likeCount }} />
      </PostHeavySubtree>
      {/* 文章配了背景就铺满非内容区，没配则沿用全站背景 */}
      <PostBackground background={post.background} />
      <SiteShell
        stickySidebar={false}
        sidebar={(
        // 侧栏与正文等高，只让目录吸顶
          <div className="flex h-full flex-col gap-4">
            <BlogSidebarAbout />
            <PostHeavySubtree postId={post.id} bypass={isDraft}>
              <PostToc
                headings={headings}
                className="hidden lg:sticky lg:top-[calc(var(--nav-h)+1rem)] lg:block"
              />
            </PostHeavySubtree>
          </div>
        )}
      >
        <PostArticle post={post} html={html} isDraft={isDraft} />
        {!isDraft && neighbors && <PostContinuation neighbors={neighbors} />}
        {/* 评论区接近视口时才加载（见 DeferredCommentSection）；id 供顶栏迷你目录「去评论区」跳转 */}
        {commentEnabled && (
          <div id="comments" className="surface-card scroll-mt-[calc(var(--nav-h)+1rem)] rounded-2xl bg-card p-5 sm:p-7 md:p-8">
            <PostHeavySubtree postId={post.id} bypass={isDraft} preserveHeight>
              <DeferredCommentSection
                targetType={TargetType.Post}
                ownerId={post.user.id}
                owner={{
                  id: post.user.id,
                  username: post.user.username,
                  nickname: post.user.nickname,
                  avatarUrl: post.user.avatarUrl,
                  gravatarHash: post.user.gravatarHash,
                }}
                targetId={post.id}
                totalCount={post.commentCount}
              />
            </PostHeavySubtree>
          </div>
        )}
      </SiteShell>
    </>
  )
}
