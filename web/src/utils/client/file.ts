import type { FileModel } from '@/models/file'
import { FileIcon, FilePlayIcon, ImageIcon, MusicIcon } from 'lucide-react'

export function getFileUri(id: number) {
  return `/api/v1/file/f/${id}`
}

export const mimeTypes = {
  image: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/bmp',
    'image/webp',
    'image/svg+xml',
  ],
  audio: [
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/flac',
    'audio/aac',
    'audio/webm',
  ],
  video: [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/avi',
    'video/mpeg',
    'video/quicktime',
  ],
}

export const mimeTypeIcons = {
  image: ImageIcon,
  audio: MusicIcon,
  video: FilePlayIcon,
  file: FileIcon,
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'application/zip': 'zip',
  'application/gzip': 'gz',
  'application/x-tar': 'tar',
  'application/x-7z-compressed': '7z',
  'application/vnd.rar': 'rar',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/html': 'html',
  'text/css': 'css',
  'text/csv': 'csv',
  'text/javascript': 'js',
  'application/javascript': 'js',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/webm': 'weba',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/ogg': 'ogv',
  'video/x-matroska': 'mkv',
  'video/avi': 'avi',
  'video/x-msvideo': 'avi',
}

const EXT_CATEGORY: Record<string, keyof typeof mimeTypeIcons> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  svg: 'image',
  ico: 'image',
  heic: 'image',
  heif: 'image',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  aac: 'audio',
  m4a: 'audio',
  opus: 'audio',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  avi: 'video',
  m4v: 'video',
}

/** 按常见 MIME 类型推导扩展名（替代整包 mime-db，避免客户端打包 180 KB 映射表） */
export function extensionFromMime(mimeType: string): string | null {
  const clean = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!clean)
    return null
  if (MIME_TO_EXT[clean])
    return MIME_TO_EXT[clean]
  const sub = clean.split('/')[1]?.split('+')[0]
  return sub && /^[\w-]{1,10}$/.test(sub) ? sub : null
}

/** 按文件 MIME 或扩展名判断图标大类 */
export function mimeCategoryFromFile(file: { name: string, type: string }): keyof typeof mimeTypeIcons {
  const prefix = file.type.split('/')[0]?.toLowerCase()
  if (prefix === 'image' || prefix === 'audio' || prefix === 'video')
    return prefix
  const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : undefined
  return (ext && EXT_CATEGORY[ext]) || 'file'
}

export function getFileIcon({ file, showImage = true }: { file: FileModel, showImage?: boolean }) {
  if (mimeTypes.image.includes(file.mimeType)) {
    if (showImage) {
      return getFileUri(file.id)
    }
    else {
      return mimeTypeIcons.image
    }
  }
  if (mimeTypes.audio.includes(file.mimeType)) {
    return mimeTypeIcons.audio
  }
  if (mimeTypes.video.includes(file.mimeType)) {
    return mimeTypeIcons.video
  }
  return mimeTypeIcons.file
}
