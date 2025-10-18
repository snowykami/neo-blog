import type { PaginationParams } from '../models/common'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

export interface DashboardResp {
  totalUsers: number
  totalPosts: number
  totalComments: number
  totalViews: number
}

export async function getDashboard(): Promise<BaseResponse<DashboardResp>> {
  const res = await axiosClient.get<BaseResponse<DashboardResp>>('/admin/dashboard')
  return res.data
}

export async function listUsers(params: PaginationParams) {
  const res = await axiosClient.get<BaseResponse<{ users: any[], total: number }>>(
    '/admin/users',
    { params },
  )
  return res.data
}
