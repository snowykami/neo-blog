'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export interface ImageAvatarProps {
  src?: string | null
  alt?: string
  // 图片缺失或加载失败时显示的内容（首字母、图标等）
  fallback?: React.ReactNode
  className?: string
  imageClassName?: string
  fallbackClassName?: string
}

/**
 * 通用图片头像：任意图片 + 兜底内容，不限于用户
 * 用于第三方登录提供商图标、站点图标等；用户头像请使用 UserAvatar
 */
export function ImageAvatar({ src, alt = '', fallback, className, imageClassName, fallbackClassName }: ImageAvatarProps) {
  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt={alt} className={cn('object-cover', imageClassName)} />}
      <AvatarFallback className={cn('rounded-[inherit]', fallbackClassName)}>{fallback}</AvatarFallback>
    </Avatar>
  )
}
