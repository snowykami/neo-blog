import axiosClient from './client'
import type { BaseResponse } from '@/models/resp'
import { TargetType } from '@/models/types'
import { User } from '@/models/user'


export async function toggleLike(
  { targetType, targetId }: { targetType: TargetType, targetId: number },
): Promise<BaseResponse<{ status: boolean }>> {
  const res = await axiosClient.put<BaseResponse<{ status: boolean }>>('/like/toggle', { targetType, targetId })
  return res.data
}

export async function getLikedUsers(
  { targetType, targetId, number }: { targetType: TargetType, targetId: number, number: number },
): Promise<BaseResponse<{ users: User[] }>> {
  const res = await axiosClient.get<BaseResponse<{ users: User[] }>>('/like/liked_users', { params: { targetType, targetId, number } })
  return res.data
}