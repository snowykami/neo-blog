"use client";

import { useEffect } from "react";
import type { Post } from "@/models/post";

function WaveHeader({ title }: { title: string }) {
  return (
    <div className="relative h-64 flex flex-col items-center justify-center">
      {/* 波浪SVG，半透明悬浮 */}
      <div className="absolute inset-0 w-full h-full pointer-events-none opacity-70 z-0">
        <svg className="w-full h-full" viewBox="0 0 1440 320" preserveAspectRatio="none">
          <defs>
            <linearGradient id="wave-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#4f8cff" />
              <stop offset="100%" stopColor="#7b61ff" />
            </linearGradient>
          </defs>
          <path
            fill="url(#wave-gradient)"
            fillOpacity="1"
            d="
              M0,160 
              C360,240 1080,80 1440,160 
              L1440,320 
              L0,320 
              Z
            "
          >
            <animate
              attributeName="d"
              dur="8s"
              repeatCount="indefinite"
              values="
                M0,160 C360,240 1080,80 1440,160 L1440,320 L0,320 Z;
                M0,120 C400,200 1040,120 1440,200 L1440,320 L0,320 Z;
                M0,160 C360,240 1080,80 1440,160 L1440,320 L0,320 Z
              "
            />
          </path>
        </svg>
      </div>
      {/* 标题 */}
      <h1 className="relative z-10 text-white text-4xl md:text-5xl font-bold drop-shadow-lg mt-16 text-center">
        {title}
      </h1>
    </div>
  );
}

function BlogMeta({ post }: { post: Post }) {
  return (
    <div className="flex flex-col items-center mb-6">
      <div className="flex gap-2 mb-2">
        {post.labels?.map(label => (
          <span
            key={label.id}
            className="bg-white/30 px-3 py-1 rounded-full text-sm font-medium backdrop-blur text-white"
          >
            {label.key}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-base text-white/90">
        <span>发表于 {new Date(post.createdAt).toLocaleDateString()}</span>
        <span>👁️ {post.viewCount}</span>
        <span>💬 {post.commentCount}</span>
        <span>🔥 {post.heat}</span>
      </div>
    </div>
  );
}

function BlogContent({ post }: { post: Post }) {
  return (
    <main className="relative z-10 max-w-3xl mx-auto bg-white rounded-xl shadow-lg p-8 -mt-32">
      {post.cover && (
        <img
          src={post.cover}
          alt="cover"
          className="w-full h-64 object-cover rounded-lg mb-8"
        />
      )}
      <article
        className="prose prose-lg max-w-none"
        dangerouslySetInnerHTML={{ __html: post.content }}
      />
    </main>
  );
}

function BlogPost({ post }: { post: Post }) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, []);
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 relative">
      <WaveHeader title={post.title} />
      <div className="relative z-10 -mt-40">
        <BlogMeta post={post} />
        <BlogContent post={post} />
      </div>
    </div>
  );
}

export default BlogPost;