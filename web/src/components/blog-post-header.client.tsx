"use client"
import { useBackground } from "@/contexts/background-context";
import type { Post } from "@/models/post";
import { useEffect, useRef,Suspense } from "react";
import { Calendar, Clock, FileText, Flame, Heart, MessageCircle, PenLine, SquarePen } from "lucide-react";

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

export default function PostHeader({ post }: { post: Post }) {
  const { setBackground } = useBackground();
  const headerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (headerRef.current) {
      const { clientHeight } = headerRef.current;
      setBackground(<div className={`bg-gradient-to-br from-blue-700 to-purple-700 dark:from-blue-500 dark:to-purple-500`} style={{ height: clientHeight }} />);
    }
  }, [headerRef, setBackground]);
  return (
    <div className="py-32" ref={headerRef}>
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
      )
      }
      <h1 className="text-5xl font-bold mb-2 text-primary-foreground">{post.title}</h1>
      {/* 元数据区 */}
      <div>
        <PostMeta post={post} />
      </div>
    </div>
  );
}