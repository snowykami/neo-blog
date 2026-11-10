/**
 * 纯附件评论在通知快照里的占位标记，与后端 service.NotificationAttachmentMarker 一致：
 * [[neo:attachment:image:3]]、[[neo:attachment:file:1]]。库里不存某种语言的「[图片]」，渲染时按界面语言翻译
 */
const ATTACHMENT_MARKER = /^\[\[neo:attachment:(image|file):(\d+)\]\]$/

export interface AttachmentMarker {
  kind: 'image' | 'file'
  count: number
}

export function parseAttachmentMarker(excerpt: string): AttachmentMarker | null {
  const match = ATTACHMENT_MARKER.exec(excerpt.trim())
  if (!match)
    return null
  return { kind: match[1] as AttachmentMarker['kind'], count: Math.max(1, Number(match[2])) }
}

// attachmentMarkerKey 对应 Notifications 下的文案键与参数
export function attachmentMarkerMessage(marker: AttachmentMarker): { key: 'attachment_image' | 'attachment_images' | 'attachment_file' | 'attachment_files', count: number } {
  if (marker.kind === 'image')
    return { key: marker.count === 1 ? 'attachment_image' : 'attachment_images', count: marker.count }
  return { key: marker.count === 1 ? 'attachment_file' : 'attachment_files', count: marker.count }
}
