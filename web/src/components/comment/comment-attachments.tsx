'use client'

import type { CommentAttachment } from '@/models/comment'
import { DownloadIcon, FileIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { ImageViewer } from '@/components/blog-post/content-image-viewer'
import { ImagePlaceholder, SafeImage } from '@/components/common/safe-image'
import { cn } from '@/lib/utils'
import { formatDataSize } from '@/utils/common/datasize'

/** 一条评论最多的附件数，与后端一致 */
export const MAX_COMMENT_ATTACHMENTS = 9

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file'

/** 附件的展示方式：浏览器播放不了的音视频（如 AVI）按普通文件显示 */
export function attachmentKind(mimeType: string): AttachmentKind {
  const type = mimeType.toLowerCase().split(';')[0].trim()
  if (type.startsWith('image/'))
    return 'image'
  for (const kind of ['video', 'audio'] as const) {
    if (type.startsWith(`${kind}/`))
      return typeof document === 'undefined' || document.createElement(kind).canPlayType(type) ? kind : 'file'
  }
  return 'file'
}

export function attachmentName(attachment: CommentAttachment) {
  return attachment.name || `file-${attachment.id}`
}

/**
 * 评论附件：图片为缩略图网格（点击全屏查看），音视频用原生播放器，其余文件显示文件名与下载链接
 */
export function CommentAttachments({ attachments, className }: { attachments?: CommentAttachment[], className?: string }) {
  const t = useTranslations('Comment')
  const [viewing, setViewing] = useState<number | null>(null)
  if (!attachments?.length)
    return null

  const groups: Record<AttachmentKind, CommentAttachment[]> = { image: [], video: [], audio: [], file: [] }
  attachments.forEach(attachment => groups[attachmentKind(attachment.mimeType)].push(attachment))
  const images = groups.image
  const single = images.length === 1

  return (
    <div className={cn('grid gap-2', className)}>
      {images.length > 0 && (
        // 单张图按原始比例显示（截图常为宽屏或竖长），多张图为方形缩略图网格
        <div className={cn('grid gap-1.5', single ? 'justify-items-start' : images.length === 4 ? 'max-w-60 grid-cols-2' : 'max-w-90 grid-cols-3')}>
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              aria-label={t('view_attachment', { name: attachmentName(image) })}
              onClick={() => setViewing(index)}
              className={cn('relative cursor-zoom-in overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', single ? 'min-h-16 min-w-16' : 'aspect-square')}
            >
              {single
                ? <SafeImage src={image.url} alt={attachmentName(image)} width={0} height={0} sizes="320px" className="block h-auto max-h-80 w-auto max-w-xs" fallback={<ImagePlaceholder className="size-32" />} />
                : <SafeImage src={image.url} alt={attachmentName(image)} fill sizes="120px" className="object-cover" />}
            </button>
          ))}
        </div>
      )}
      {groups.video.map(video => (
        <video key={video.id} src={video.url} controls preload="metadata" className="max-h-80 w-full max-w-sm rounded-lg bg-black" />
      ))}
      {groups.audio.map(audio => (
        <div key={audio.id} className="grid max-w-md gap-1">
          <span className="truncate text-xs text-muted-foreground">{attachmentName(audio)}</span>
          <audio src={audio.url} controls preload="none" className="h-10 w-full" />
        </div>
      ))}
      {groups.file.map(file => (
        <a
          key={file.id}
          href={file.url}
          download={attachmentName(file)}
          target="_blank"
          rel="noopener noreferrer"
          title={t('download_attachment', { name: attachmentName(file) })}
          className="flex max-w-md items-center gap-3 rounded-lg border bg-card px-3 py-2 transition-colors hover:bg-muted"
        >
          <FileIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-sm">{attachmentName(file)}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{formatDataSize({ size: file.size })}</span>
          </span>
          <DownloadIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </a>
      ))}
      <ImageViewer
        images={images.map(image => ({ src: image.url, alt: attachmentName(image), caption: '' }))}
        index={viewing}
        onIndexChange={setViewing}
      />
    </div>
  )
}
