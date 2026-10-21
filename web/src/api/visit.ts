import type { BaseResponse } from '@/models/resp'
import type { VisitTargetType } from '@/models/visit'
import axiosClient from './client'

// 上报一次访问，后端会写入/刷新访客 Cookie
export async function reportVisit(visit: {
  path: string
  targetType?: VisitTargetType
  targetId?: number
  referrer?: string
  fingerprint?: string
}): Promise<BaseResponse<null>> {
  const res = await axiosClient.post('/visit', visit)
  return res.data
}
