"use client";

import { useEffect } from "react";
import type { Post } from "@/models/post";
import { Calendar, Clock, FileText, Flame, Heart, MessageCircle, PenLine, SquarePen } from "lucide-react";

function PostMeta({ post }: { post: Post }) {
  // 假设 post 结构包含这些字段
  // post.author, post.wordCount, post.readMinutes, post.createdAt, post.isOriginal, post.viewCount, post.commentCount
  return (
    console.log(post),
    <div className="flex flex-wrap items-center gap-4 mt-6">
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
  // 三排 标签/标题/一些元数据
  return (
    <div className="py-32">
      {
        post.labels && post.labels.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {post.labels.map(label => (
              <span key={label.id} className="bg-blue-100 text-blue-600 text-xs px-2 py-1 rounded">
                {label.key}
              </span>
            ))}
          </div>
        )
      }
      <h1 className="text-5xl font-bold mb-2">{post.title}</h1>
      {/* 元数据区 */}
      <div>
        <PostMeta post={post} />
      </div>
    </div>
  );
}

function PostContent({ post }: { post: Post }) {
  return (
    <div className="">
      <div dangerouslySetInnerHTML={{ __html: post.content }} />
    </div>
  )
}


function BlogPost({ post }: { post: Post }) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, []);
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