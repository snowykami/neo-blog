import { Suspense } from "react";
import type { Post } from "@/models/post";
import { Calendar, Clock, FileText, Flame, Heart, MessageCircle, PenLine, SquarePen } from "lucide-react";
import { MDXRemote } from "next-mdx-remote-client/rsc";

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
        {post.content.length / 100 || 1} 分钟
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

function PostHeader({ post }: { post: Post }) {
  return (
    <div className="relative py-32">
      {/* 背景层 */}
      <div
        className="pointer-events-none absolute inset-0 left-1/2 right-1/2 w-screen -translate-x-1/2 bg-gradient-to-bl from-blue-700 to-purple-700 dark:from-blue-500 dark:to-purple-500"
        aria-hidden="true"
        style={{ zIndex: -1 }}
      />
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
    </div>
  );
}

async function PostContent({ post }: { post: Post }) {
  return (
    <div className="py-12">
      {post.type === "html" && (
        <div
          className="prose prose-lg max-w-none dark:prose-invert [&_h1]:text-5xl [&_h2]:text-4xl [&_h3]:text-3xl [&_h4]:text-2xl [&_h5]:text-xl [&_h6]:text-lg [&_p]:text-xl [&_p]:my-6 [&_ul]:my-6 [&_ol]:my-6 [&_pre]:my-8 [&_blockquote]:my-8"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      )}
      {post.type === "markdown" && (
        <Suspense>
          <MDXRemote
            source={post.content}
          />
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
    <div className="">
      <PostHeader post={post} />
      <div className="">
        <PostContent post={post} />
      </div>
    </div>
  );
}

export default BlogPost;