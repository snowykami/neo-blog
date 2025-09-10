import { Suspense } from "react";
import type { Post } from "@/models/post";
import { Calendar, Clock, FileText, Flame, Heart, MessageCircle, PenLine, SquarePen } from "lucide-react";
import { RenderMarkdown } from "@/components/common/markdown";
import { isMobileByUA } from "@/utils/server/device";
import { calculateReadingTime } from "@/utils/common/post";
import { CommentSection } from "@/components/comment";
import { TargetType } from '@/models/types';
import * as motion from "motion/react-client"
import config from "@/config";

function PostMeta({ post }: { post: Post }) {
  return (
    <div className="flex flex-wrap items-center gap-4 mt-6 text-secondary">
      {/* 作者 */}
      <span className="flex items-center gap-1">
        <PenLine className="w-4 h-4" />
        {post.user.nickname || "未知作者"}
      </span>
      {/* 字数 */}
      <span className="flex items-center gap-1">
        <FileText className="w-4 h-4" />
        {post.content.length || 0}
      </span>
      {/* 阅读时间 */}
      <span className="flex items-center gap-1">
        <Clock className="w-4 h-4" />
        {calculateReadingTime(post.content)} 分钟
      </span>
      {/* 发布时间 */}
      <span className="flex items-center gap-1">
        <Calendar className="w-4 h-4" />
        {post.createdAt ? new Date(post.createdAt).toLocaleDateString("zh-CN") : ""}
      </span>
      {/* 最后编辑时间，如果和发布时间不一样 */}
      {post.updatedAt && post.createdAt !== post.updatedAt && (
        <span className="flex items-center gap-1">
          <SquarePen className="w-4 h-4" />
          {new Date(post.updatedAt).toLocaleDateString("zh-CN")}
        </span>
      )}
      {/* 浏览数 */}
      <span className="flex items-center gap-1">
        <Flame className="w-4 h-4" />
        {post.viewCount || 0}
      </span>
      {/* 点赞数 */}
      <span className="flex items-center gap-1">
        <Heart className="w-4 h-4" />
        {post.likeCount || 0}
      </span>
      {/* 评论数 */}
      <span className="flex items-center gap-1">
        <MessageCircle className="w-4 h-4" />
        {post.commentCount || 0}
      </span>
      {/* 热度 */}
      <span className="flex items-center gap-1">
        <Flame className="w-4 h-4" />
        {post.heat || 0}
      </span>
    </div>
  );
}

async function PostHeader({ post }: { post: Post }) {
  const isMobile = await isMobileByUA();
  return (
    <div className={`relative ${isMobile ? "py-16" : "py-32"}`}>
      {/* 背景层 */}
      <div
        className="pointer-events-none absolute inset-0 left-1/2 right-1/2 w-screen -translate-x-1/2 bg-gradient-to-bl from-blue-700 to-purple-700 dark:from-blue-500 dark:to-purple-500"
        aria-hidden="true"
        style={{ zIndex: -1 }}
      />
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: config.animationDurationSecond, ease: "easeOut" }}
        className="container mx-auto px-4"
      >
        {(post.labels || post.isOriginal) && (
          <div className="flex flex-wrap gap-2 mb-4">
            {post.isOriginal && (
              <span className="bg-green-100 text-green-600 text-xs px-2 py-1 rounded">
                原创
              </span>
            )}
            {(post.labels || []).map(label => (
              <span key={label.id} className="bg-blue-100 text-blue-600 text-xs px-2 py-1 rounded">
                {label.key}
              </span>
            ))}
          </div>
        )}
        <h1 className="text-5xl font-bold mb-2 text-primary-foreground">{post.title}</h1>
        {/* 元数据区 */}
        <div>
          <PostMeta post={post} />
        </div>
      </motion.div>

    </div>
  );
}

async function PostContent({ post }: { post: Post }) {
  const markdownClass =
    "prose prose-lg max-w-none dark:prose-invert " +
    // h1-h6
    "[&_h1]:scroll-m-20 [&_h1]:text-4xl [&_h1]:font-extrabold [&_h1]:tracking-tight [&_h1]:text-balance [&_h1]:mt-10 [&_h1]:mb-6 " +
    "[&_h2]:scroll-m-20 [&_h2]:border-b [&_h2]:pb-2 [&_h2]:text-3xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:first:mt-0 [&_h2]:mt-8 [&_h2]:mb-4 " +
    "[&_h3]:scroll-m-20 [&_h3]:text-2xl [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:mt-6 [&_h3]:mb-3 " +
    "[&_h4]:scroll-m-20 [&_h4]:text-xl [&_h4]:font-semibold [&_h4]:tracking-tight [&_h4]:mt-5 [&_h4]:mb-2 " +
    // p
    "[&_p]:leading-7 [&_p]:mt-4 [&_p]:mb-4 " +
    // blockquote
    "[&_blockquote]:border-l-4 [&_blockquote]:border-blue-400 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:my-6 [&_blockquote]:py-2 " +
    // code
    "[&_code]:bg-gray-100 [&_code]:dark:bg-gray-800 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm [&_code]:font-mono " +
    // a
    "[&_a]:text-blue-600 [&_a]:hover:underline";
  return (
    <div className="prose prose-lg max-w-none dark:prose-invert">
      {post.type === "html" && (
        <div
          className={`${markdownClass}`}
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      )}
      {post.type === "markdown" && (
        <Suspense>
          <RenderMarkdown source={post.content} />
        </Suspense>
      )}
      {post.type === "text" && (
        <div className="text-xl text-slate-700 dark:text-slate-300 my-6">
          {post.content}
        </div>
      )}
    </div>
  );
}


async function BlogPost({ post }: { post: Post }) {
  return (
    <div className="h-full">
      {/* <ScrollToTop /> */}
      <PostHeader post={post} />
      <PostContent post={post} />
      <CommentSection targetType={TargetType.Post} targetId={post.id} totalCount={post.commentCount} />
    </div>
  );
}

export default BlogPost;