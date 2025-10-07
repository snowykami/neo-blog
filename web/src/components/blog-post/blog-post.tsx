
import { Suspense } from "react";
import type { Post } from "@/models/post";
import { ArchiveIcon, Calendar, Clock, FileText, Flame, Heart, Info, MessageCircle, PenLine, SquarePen } from "lucide-react";
import { calculateReadingTime } from "@/utils/common/post";
import { CommentSection } from "@/components/comment";
import { TargetType } from '@/models/types';
import * as motion from "motion/react-client"
import { getSiteInfo } from "@/api/misc";
import Sidebar from "../blog-sidebar";
import { SidebarAbout, SidebarLabels, SidebarMisskeyIframe } from "../blog-sidebar/blog-sidebar-card";
import CopyrightCard from "./blog-copyright.client";
import { navStickyTopPx } from "@/utils/common/layout-size";
import { BlogLikeButton } from "./blog-like-button.client";
import { fallbackSiteInfo } from "@/utils/common/siteinfo";
import { getTranslations } from "next-intl/server";
import { Separator } from "../ui/separator";
import Typewriter from "../common/typewriter";
import { PostHeaderClient } from "./post-header.client";
import "./blog-post-align.scss";

import HtmlEnhancer from "./blog-content-enhanced";

async function PostHeader({ post }: { post: Post }) {
  const siteInfo = await getSiteInfo().then(res => res.data).catch(() => fallbackSiteInfo);
  return (
    <PostHeaderClient post={post} siteInfo={{ defaultCover: siteInfo.defaultCover }}>
      <PostMetaWhite post={post} />
    </PostHeaderClient>
  );
}

// 适配白色背景的 PostMeta 组件
async function PostMetaWhite({ post }: { post: Post }) {
  const t = await getTranslations()
  const metaItems = [
    {
      icon: PenLine,
      text: post.user.nickname || post.user.username || t("Common.unknown_author"),
    },
    {
      icon: ArchiveIcon,
      text: post.category ? post.category.name : t("Console.post_edit.uncategorized"),
    },
    {
      icon: Calendar,
      text: post.createdAt ? new Date(post.createdAt).toLocaleDateString("zh-CN") : "",
    },
    {
      icon: Clock,
      text: `${calculateReadingTime(post.content)} ${t("Common.minutes")}`,
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
      text: `${post.content.length || 0} ${t("Common.char")}`,
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
  );
}

async function PostContent({ post }: { post: Post }) {
  const t = await getTranslations("Common")
  return (
    <div className="bg-background border-1 pt-4 p-4 md:pt-8 md:p-8 rounded-xl">
      {post.description && <div className="md:mt-0 mb-8 bg-primary/10 text-lg text-muted-foreground border-1 rounded-xl p-4 font-mono">
        <div className="flex items-center mb-2 text-lg text-primary font-medium">
          <Info className="w-5 h-5 mr-2" />
          {t("digest")}
        </div>
        <Separator className="my-2" />
        <Typewriter text={post.description} />
      </div>}

      {post.type === "html" && (
        <>
          <article id="blog-content" className="prose prose-lg max-w-none dark:prose-invert 
          p-4 md:p-8 rounded-xl bg-background border border-border
          prose-img:block prose-img:mx-auto prose-img:my-4 prose-img:rounded-lg prose-img:shadow-md prose-img:border prose-img:border-border
          prose-a:text-primary prose-a:no-underline prose-a:font-medium prose-a:hover:underline prose-a:px-1
          prose-h1:scroll-mt-24 prose-h2:scroll-mt-24 prose-h3:scroll-mt-24 prose-h4:scroll-mt-24
          prose-blockquote:dark:border-primary/70
          prose-blockquote:border-l-4 prose-blockquote:border-primary/70 prose-blockquote:bg-muted/50 prose-blockquote:px-4 prose-blockquote:py-2
          " dangerouslySetInnerHTML={{ __html: post.content }} />
          <HtmlEnhancer containerId="blog-content" />
        </>
      )}
      {/* 版权卡片 */}
      <CopyrightCard post={post} />
      {/* 点赞按钮 */}
      <BlogLikeButton post={post} />
    </div>
  );
}


export async function BlogPost({ post }: { post: Post }) {
  const siteInfo = await getSiteInfo().then(res => res.data).catch(() => fallbackSiteInfo);
  return (
    <div className="h-full">
      {/* <ScrollToTop /> */}
      <motion.div
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        className="transition-none"
        transition={{ duration: siteInfo.animationDurationSecond, ease: "easeOut" }}>
        <PostHeader post={post} />
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 py-4">
        {/* 正文和评论区 */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-3 transition-none"
          transition={{ duration: siteInfo.animationDurationSecond, ease: "easeOut" }}>
          <PostContent post={post} />
          <div className="bg-background mt-4 p-0 md:p-8 rounded-xl border border-border">
            <CommentSection targetType={TargetType.Post} ownerId={post.user.id} targetId={post.id} totalCount={post.commentCount} />
          </div>
        </motion.div>

        {/* 侧边栏 */}
        <motion.div
          className={`sticky self-start transition-none`}
          initial={{ x: 80, opacity: 0 }}
          animate={{ x: 0, y: 0, opacity: 1 }}
          style={{ top: navStickyTopPx }}
          transition={{ duration: siteInfo.animationDurationSecond, ease: "easeOut" }}
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
  );
}
