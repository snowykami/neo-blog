'use client'

import type { ImageAvatarProps } from './image-avatar'
import type { User } from '@/models/user'
import { cn } from '@/lib/utils'
import { getAvatarOrGravatarUrlFromUser } from '@/utils/common/gravatar'
import { getFallbackAvatarStyle, getFirstCharFromUser } from '@/utils/common/username'
import { ImageAvatar } from './image-avatar'

type AvatarUser = Pick<User, 'avatarUrl' | 'gravatarHash' | 'username' | 'nickname'>

/**
 * 用户头像：全平台统一的头像解析优先级（见 getAvatarOrGravatarUrlFromUser）与首字兜底
 * size 为请求的图片像素尺寸（Gravatar 按此裁剪），显示尺寸由 className 控制
 * 没有头像或加载失败时显示首字头像：按用户名固定的渐变底色，字号默认随头像尺寸缩放，可用 fallbackClassName 覆盖
 */
export function UserAvatar({
  user,
  size = 120,
  ...props
}: { user: AvatarUser, size?: number } & Omit<ImageAvatarProps, 'src' | 'fallback'>) {
  return (
    <ImageAvatar
      src={getAvatarOrGravatarUrlFromUser({ user, size })}
      alt={props.alt ?? (user.nickname || user.username)}
      fallback={getFirstCharFromUser(user)}
      fallbackStyle={getFallbackAvatarStyle(user.username || user.nickname || '')}
      // size 按 2 倍屏请求，显示宽度约为它的一半；站内图片据此取缩小后的尺寸
      sizes={`${Math.ceil(size / 2)}px`}
      {...props}
      className={cn('@container', props.className)}
      fallbackClassName={cn('text-[length:40cqw] font-semibold text-white', props.fallbackClassName)}
    />
  )
}
