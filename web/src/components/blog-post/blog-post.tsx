import type { Post } from '@/models/post'
import {
  ArchiveIcon,
  Calendar,
  Clock,
  FileText,
  Flame,
  Heart,
  Info,
  MessageCircle,
  PenLine,
} from 'lucide-react'
import * as motion from 'motion/react-client'
import { getTranslations } from 'next-intl/server'
import { getSiteInfo } from '@/api/misc'
import { CommentSection } from '@/components/comment'
import { TargetType } from '@/models/types'
import { contentAreaPaddingClass, navStickyTopPx } from '@/utils/common/layout-size'
import { calculateReadingTime } from '@/utils/common/post'
import { fallbackSiteInfo, getDefaultCoverRandomly } from '@/utils/common/siteinfo'
import Sidebar from '../blog-sidebar'
import {
  SidebarAbout,
  SidebarLabels,
  SidebarMisskeyIframe,
} from '../blog-sidebar/blog-sidebar-card'
import Typewriter from '../common/typewriter'
import { Separator } from '../ui/separator'
import HtmlEnhancer from './blog-content-enhanced'
import CopyrightCard from './blog-copyright.client'
import { BlogLikeButton } from './blog-like-button.client'
import { PostHeaderClient } from './post-header.client'

import './blog-post-align.scss'

async function PostHeader({ post }: { post: Post }) {
  return (
    <PostHeaderClient post={post}>
      <PostMetaWhite post={post} />
    </PostHeaderClient>
  )
}

// 适配白色背景的 PostMeta 组件
async function PostMetaWhite({ post }: { post: Post }) {
  const t = await getTranslations()
  const metaItems = [
    {
      icon: PenLine,
      text: post.user.nickname || post.user.username || t('Common.unknown_author'),
    },
    {
      icon: ArchiveIcon,
      text: post.category ? post.category.name : t('Console.post_edit.uncategorized'),
    },
    {
      icon: Calendar,
      text: post.createdAt ? new Date(post.createdAt).toLocaleDateString('zh-CN') : '',
    },
    {
      icon: Clock,
      text: `${calculateReadingTime(post.content)} ${t('Common.minutes')}`,
    },
    {
      icon: Flame,
      text: post.viewCount || 0,
    },
    {
      icon: Heart,
      text: post.likeCount || 0,
    },
    {
      icon: MessageCircle,
      text: post.commentCount || 0,
    },
    {
      icon: FileText,
      text: `${post.content.length || 0} ${t('Common.char')}`,
    },
  ]

  return (
    <div className="flex flex-wrap items-center gap-3 text-white/90">
      {metaItems.map((item, index) => (
        <span key={index} className="flex items-center gap-1.5 text-sm">
          <item.icon className="w-4 h-4 text-white/70" />
          <span className="font-medium">{item.text}</span>
        </span>
      ))}
    </div>
  )
}

async function PostContent({ post, isDraft }: { post: Post, isDraft?: boolean }) {
  const t = await getTranslations('Common')
  return (
    <div className="bg-transparent md:bg-background md:border-1 pt-4 px-2 md:px-8 md:pt-8 md:p-8 rounded-none md:rounded-xl">
      {post.description && (
        <div className="md:mt-0 mb-4 md:mb-8 bg-primary/10 text-lg text-muted-foreground border-1 rounded-xl p-4 font-mono">
          <div className="flex items-center mb-2 text-lg text-primary font-medium">
            <Info className="w-5 h-5 mr-2" />
            {t('digest')}
          </div>
          <Separator className="my-2" />
          <Typewriter text={post.description} />
        </div>
      )}

      {/* 文章内容 */}
      <article
        id="blog-content"
        className="prose prose-lg max-w-none dark:prose-invert
          rounded-xl bg-background
          text-sm md:text-lg
          "
        dangerouslySetInnerHTML={{
          __html: (isDraft ? post.draftContent : post.content) || '<h1>No Content</h1>',
        }}
      />
      <HtmlEnhancer containerId="blog-content" />

      {/* 版权卡片 */}
      <div className="mt-4 md:mt-8">
        <CopyrightCard post={post} />
      </div>

      {/* 点赞按钮 */}
      <div className="mt-4 md:mt-8">
        <BlogLikeButton post={post} />
      </div>
    </div>
  )
}

export async function BlogPost({ post, isDraft = false }: { post: Post, isDraft?: boolean }) {
  const siteInfo = await getSiteInfo()
    .then(res => res.data)
    .catch(() => fallbackSiteInfo)
  if (!post.cover) {
    post.cover = getDefaultCoverRandomly(siteInfo)
  }
  return (
    <div className="h-full">
      {/* <ScrollToTop /> */}
      <motion.div
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        className="transition-none"
        transition={{
          duration: siteInfo.animationDurationSecond,
          ease: 'easeOut',
        }}
      >
        <PostHeader post={post} />
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 py-4">
        {/* 正文和评论区 */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-3 transition-none "
          transition={{
            duration: siteInfo.animationDurationSecond,
            ease: 'easeOut',
          }}
        >
          <PostContent post={post} isDraft={isDraft} />
          <div
            className={`bg-background mt-4 rounded-xl border border-border ${contentAreaPaddingClass} py-4 md:py-8`}
          >
            <CommentSection
              targetType={TargetType.Post}
              ownerId={post.user.id}
              targetId={post.id}
              totalCount={post.commentCount}
            />
          </div>
        </motion.div>

        {/* 侧边栏 */}
        <motion.div
          className="sticky self-start transition-none"
          initial={{ x: 80, opacity: 0 }}
          animate={{ x: 0, y: 0, opacity: 1 }}
          style={{ top: navStickyTopPx }}
          transition={{
            duration: siteInfo.animationDurationSecond,
            ease: 'easeOut',
          }}
        >
          <Sidebar
            cards={[
              <SidebarAbout key="about" />,
              <SidebarLabels key="labels" />,
              <SidebarMisskeyIframe key="misskey" />,
            ].filter(Boolean)}
          />
        </motion.div>
      </div>
    </div>
  )
}
