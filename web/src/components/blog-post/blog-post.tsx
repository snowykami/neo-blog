
import { Suspense } from "react";
import type { Post } from "@/models/post";
import { Calendar, Clock, FileText, Flame, Heart, MessageCircle, PenLine, SquarePen } from "lucide-react";
import { RenderMarkdown } from "@/components/common/markdown";
import { calculateReadingTime } from "@/utils/common/post";
import { CommentSection } from "@/components/comment";
import { TargetType } from '@/models/types';
import * as motion from "motion/react-client"
import { fallbackSiteInfo } from "@/contexts/site-info-context";
import { getSiteInfo } from "@/api/misc";
import Sidebar from "../blog-sidebar";
import { SidebarAbout, SidebarLabels, SidebarMisskeyIframe } from "../blog-sidebar/blog-sidebar-card";
import CopyrightCard from "./blog-copyright.client";
import { WaveEffects } from "./wave-effect";
import { navStickyTopPx } from "@/utils/common/layout-size";
import { contentAreaMaxWidthClass, contentAreaPaddingClass } from "@/utils/common/layout-size";
import { BlogLikeButton } from "./blog-like-button.client";

async function PostHeader({ post }: { post: Post }) {
  const siteInfo = await getSiteInfo().then(res => res.data).catch(() => fallbackSiteInfo);

  return (
    <div className={`relative pt-30 pb-36 md:pt-36 md:pb-48 overflow-hidden transition-none`} style={{ width: '100vw', marginLeft: '50%', transform: 'translateX(-50%)' }}>
      {/* 背景图片层 */}
      <div
        className="absolute inset-0"
        style={{
          zIndex: -3,
          backgroundImage: `url(${post.cover || siteInfo.defaultCover})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
        aria-hidden="true"
      />

      {/* 模糊遮罩层 */}
      <div
        className="absolute inset-0 backdrop-blur-md bg-black/30"
        style={{ zIndex: -2 }}
        aria-hidden="true"
      />

      {/* 内容层 */}
      <div className={`container mx-auto ${contentAreaPaddingClass} ${contentAreaMaxWidthClass} relative z-10`}>
        {/* 标签 */}
        {post.labels && post.labels.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {post.labels.map(label => (
              <span
                key={label.id}
                className="bg-white/20 backdrop-blur-sm text-white border border-white/30 text-xs px-3 py-1 rounded-full font-medium shadow-sm"
              >
                {label.name}
              </span>
            ))}
          </div>
        )}

        <h1 className="text-3xl md:text-5xl font-bold mb-4 text-white drop-shadow-lg leading-tight">
          {post.title}
        </h1>

        {post.description && (
          <p className="text-lg md:text-xl text-white/90 mb-6 max-w-3xl leading-relaxed drop-shadow-sm">
            {post.description}
          </p>
        )}

        <div className="backdrop-blur-sm bg-white/15 rounded-lg p-4 border border-white/20 shadow-lg">
          <PostMetaWhite post={post} />
        </div>
      </div>

      {/* 波浪层 */}
      <WaveEffects />
    </div>
  );
}

// 适配白色背景的 PostMeta 组件
function PostMetaWhite({ post }: { post: Post }) {
  const metaItems = [
    {
      icon: PenLine,
      text: post.user.nickname || post.user.username || "未知作者",
      label: "作者"
    },
    {
      icon: FileText,
      text: `${post.content.length || 0} 字`,
      label: "字数"
    },
    {
      icon: Clock,
      text: `${calculateReadingTime(post.content)} 分钟`,
      label: "阅读时间"
    },
    {
      icon: Calendar,
      text: post.createdAt ? new Date(post.createdAt).toLocaleDateString("zh-CN") : "",
      label: "发布时间"
    },
    ...(post.updatedAt && post.createdAt !== post.updatedAt ? [{
      icon: SquarePen,
      text: new Date(post.updatedAt).toLocaleDateString("zh-CN"),
      label: "最后编辑"
    }] : []),
    {
      icon: Flame,
      text: post.viewCount || 0,
      label: "浏览"
    },
    {
      icon: Heart,
      text: post.likeCount || 0,
      label: "点赞"
    },
    {
      icon: MessageCircle,
      text: post.commentCount || 0,
      label: "评论"
    }
  ];

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
  return (
    <div className="bg-background prose prose-lg max-w-none dark:prose-invert border-1 pt-0 p-4 md:p-8 rounded-xl">
      <Suspense>
        <RenderMarkdown source={post.content} />
      </Suspense>
      {/* 版权卡片 */}
      <CopyrightCard post={post} />
      {/* 点赞按钮 */}
      <BlogLikeButton post={post} />
    </div>
  );
}


async function BlogPost({ post }: { post: Post }) {
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
          <div className="bg-background mt-4 p-4 md:p-8 rounded-xl border border-border">
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

export default BlogPost;