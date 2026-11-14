'use client'

import { isSafeHref } from '@/components/content-components/safe-url'
import { LinkPreviewCard } from './link-preview-card'

export interface LinkCardContentProps {
  url: string
}

/** 链接卡片：复用正文链接悬浮预览的卡片内容 */
export default function LinkCardContent({ url = '' }: LinkCardContentProps) {
  if (!isSafeHref(url, false))
    throw new Error('Unsafe linkCard url')
  return (
    <div className="max-w-md overflow-hidden rounded-xl border bg-card">
      <LinkPreviewCard url={url} />
    </div>
  )
}
