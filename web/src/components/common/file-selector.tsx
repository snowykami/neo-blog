/* eslint-disable unused-imports/no-unused-vars */
'use client'

enum ImageType {
  JPG = 'image/jpeg',
  PNG = 'image/png',
  GIF = 'image/gif',
  BMP = 'image/bmp',
  WEBP = 'image/webp',
  SVG = 'image/svg+xml',
}

export function FileSelector({
  onFilesSelected,
  limitNumber = 1,
  limitType = ['*'],
  forceLimitType = false,
}: {
  limitNumber?: number
  limitType?: string[] // "*" 代表所有类型, "image/*" 代表所有图片类型, "video/*" 代表所有视频类型, "audio/*" 代表所有音频类型, "text/*" 代表所有文本类型, "application/*" 代表所有应用类型
  forceLimitType?: boolean
  onFilesSelected?: (files: FileList) => void
}) {
  return <div>FileSelector</div>
}
