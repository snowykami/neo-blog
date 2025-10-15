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
