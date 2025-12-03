import type { BaseResponse } from '@/models/resp'
import type { TargetType } from '@/models/types'
import type { User } from '@/models/user'
import axiosClient from './client'

export async function toggleLike({
  targetType,
  targetId,
}: {
  targetType: TargetType
  targetId: number
}): Promise<BaseResponse<{ status: boolean }>> {
  const res = await axiosClient.put('/like/toggle', {
    targetType,
    targetId,
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
