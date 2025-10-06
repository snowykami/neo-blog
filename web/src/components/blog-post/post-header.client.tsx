"use client"

import { useState } from "react";
import type { Post } from "@/models/post";
import Link from "next/link";
import { getLabelUrl } from "@/utils/common/route";
import { contentAreaMaxWidthClass, contentAreaPaddingClass } from "@/utils/common/layout-size";
import { CoverPreviewButton } from "./cover-preview-button.client";
import { WaveEffects } from "./wave-effect";

export function PostHeaderClient({
  post,
  siteInfo,
  children
}: {
  post: Post,
  siteInfo: { defaultCover: string },
  children: React.ReactNode
}) {
  const [isPreviewing, setIsPreviewing] = useState(false);

  return (
    // 允许子元素超出（眼睛按钮不会被裁切）
    <div className={`relative pt-30 pb-36 md:pt-36 md:pb-48 overflow-visible transition-none`} style={{ width: '100vw', marginLeft: '50%', transform: 'translateX(-50%)' }}>
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

      {/* 模糊遮罩层 - with transition */}
      <div
        className="absolute inset-0 transition-all duration-500 ease-in-out"
        style={{
          zIndex: -2,
          backdropFilter: isPreviewing ? 'blur(0px)' : 'blur(12px)',
          backgroundColor: isPreviewing ? 'rgba(0, 0, 0, 0)' : 'rgba(0, 0, 0, 0.3)',
        }}
        aria-hidden="true"
      />

      {/* 内容层 - with transition for opacity */}
      <div
        className={`container px-4 md:px-0 mx-auto ${contentAreaPaddingClass} ${contentAreaMaxWidthClass} relative z-10 transition-opacity duration-500 ease-in-out`}

      >
        {/* Preview button */}
        <CoverPreviewButton onPreviewChange={setIsPreviewing} />
        <div style={{ opacity: isPreviewing ? 0 : 1 }}>
          <h1
            className="text-3xl md:text-5xl font-bold mb-4 text-white drop-shadow-lg leading-tight"
          >
            {post.title}
          </h1>
          {/* 标签 */}
          {post.labels && post.labels.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {post.labels.map(label => (
                <Link href={getLabelUrl(label)} key={label.id}>
                  <span
                    className="bg-white/20 backdrop-blur-sm text-white border border-white/30 text-xs px-3 py-1 rounded-full font-medium shadow-sm"
                  >
                    {label.name}
                  </span>
                </Link>
              ))}
            </div>
          )}

          <div className="backdrop-blur-sm bg-white/15 rounded-lg p-4 border border-white/20 shadow-lg">
            {children}
          </div>
        </div>

      </div>

      {/* 波浪层 */}
      <WaveEffects />
    </div>
  );
}
