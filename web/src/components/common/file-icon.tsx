'use client'
import type { FileModel } from '@/models/file'
import { getFileIcon } from '@/utils/client/file'

export function FileMimeIcon({ file, showImage, className }: { file: FileModel, showImage?: boolean, className?: string }) {
  const icon = getFileIcon({ file, showImage })
  if (typeof icon === 'string') {
    return <img src={icon} alt={file.name} className={className} />
  }
  const IconComponent = icon
  return <IconComponent className={className} />
}
