import type { PaginationParams } from '@/models/common'
import type { UserLike } from '@/models/like'
import type { BaseResponse } from '@/models/resp'
import type { TargetType } from '@/models/types'
import type { User } from '@/models/user'
import axiosClient from './client'

export async function toggleLike({
  targetType,
  targetId,
  liked,
}: {
  targetType: TargetType
  targetId: number
  liked?: boolean // 期望的点赞状态；不传时取反，传入时幂等，页面状态过期也不会点反
}): Promise<BaseResponse<{ status: boolean }>> {
  const res = await axiosClient.put('/like/toggle', {
    targetType,
    targetId,
    liked,
  })
  return res.data
}

export async function getLikedUsers({
  targetType,
  targetId,
  number,
}: {
  targetType: TargetType
  targetId: number
  number: number
}): Promise<BaseResponse<{ users: User[] }>> {
  const res = await axiosClient.get('/like/liked_users', {
    params: { targetType, targetId, number },
  })
  return res.data
}

// 用户主页：列出某用户的点赞记录，仅本人与管理员可见
export async function listUserLikes({
  userId,
  page = 1,
  size = 10,
}: {
  userId: number
} & Pick<PaginationParams, 'page' | 'size'>): Promise<BaseResponse<{ likes: UserLike[], total: number }>> {
  const res = await axiosClient.get('/like/user', {
    params: { userId, page, size },
  })
  return res.data
}
