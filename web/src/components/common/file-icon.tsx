'use client'
import type { FileModel } from '@/models/file'
import { SafeImage } from '@/components/common/safe-image'
import { getFileIcon } from '@/utils/client/file'

export function FileMimeIcon({
  file,
  showImage,
  size = 80,
  className,
}: {
  file: FileModel
  showImage?: boolean
  /** 缩略图目标边长（px），用于 Next 图片优化裁剪 */
  size?: number
  className?: string
}) {
  const icon = getFileIcon({ file, showImage })
  if (typeof icon === 'string') {
    return (
      <SafeImage
        src={icon}
        alt={file.name}
        width={size}
        height={size}
        sizes={`${size}px`}
        quality={size <= 64 ? 45 : 60}
        className={className}
      />
    )
  }
  const IconComponent = icon
  return <IconComponent className={className} />
}
