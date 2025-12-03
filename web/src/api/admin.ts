import type { PaginationParams } from '../models/common'
import type { BaseResponse } from '@/models/resp'
import type { User } from '@/models/user'
import axiosClient from './client'

export interface DashboardResp {
  totalUsers: number
  totalPosts: number
  totalComments: number
  totalViews: number
}

export async function getDashboard(): Promise<BaseResponse<DashboardResp>> {
  const res = await axiosClient.get('/admin/dashboard')
  return res.data
}

export async function listUsers(params: PaginationParams): Promise<BaseResponse<{ users: User[], total: number }>> {
  const res = await axiosClient.get(
    '/admin/users',
    { params },
  )
  return res.data
}

export async function listCommentsAdmin(pagination: PaginationParams, query: string): Promise<BaseResponse<{ comments: Comment[], total: number }>> {
  const res = await axiosClient.get(
    '/admin/comments',
    { params: { ...pagination, query } },
  )
  return res.data
}
