'use client'

import type { ImageAvatarProps } from './image-avatar'
import type { User } from '@/models/user'
import { getAvatarOrGravatarUrlFromUser } from '@/utils/common/gravatar'
import { getFirstCharFromUser } from '@/utils/common/username'
import { ImageAvatar } from './image-avatar'

type AvatarUser = Pick<User, 'avatarUrl' | 'gravatarHash' | 'username' | 'nickname'>

/**
 * 用户头像：全平台统一的头像解析优先级（见 getAvatarOrGravatarUrlFromUser）与首字母兜底
 * size 为请求的图片像素尺寸（Gravatar 按此裁剪），显示尺寸由 className 控制
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
      {...props}
    />
  )
}
