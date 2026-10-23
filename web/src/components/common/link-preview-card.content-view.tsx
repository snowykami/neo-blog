'use client'

import type { LinkCardContentProps } from './link-preview-card.content'
import { LinkPreviewCard } from './link-preview-card'

/** 链接卡片：复用正文链接悬浮预览的卡片内容 */
export default function LinkCardContent({ url }: LinkCardContentProps) {
  return (
    <div className="max-w-md overflow-hidden rounded-xl border bg-card">
      <LinkPreviewCard url={url} />
    </div>
  )
}
