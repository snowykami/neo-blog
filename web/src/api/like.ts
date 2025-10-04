import axiosClient from './client'
import type { BaseResponse } from '@/models/resp'
import { TargetType } from '@/models/types'


export async function toggleLike(
    { targetType, targetId }: { targetType: TargetType, targetId: number },
): Promise<BaseResponse<{ status: boolean }>> {
    const res = await axiosClient.put<BaseResponse<{ status: boolean }>>('/like/toggle', { targetType, targetId })
    return res.data
}
