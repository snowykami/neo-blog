import type { PaginationParams } from '../models/common'
import type { Comment } from '@/models/comment'
import type { OidcConfig } from '@/models/oidc-config'
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

export interface KVItem {
  key: string
  value: unknown
}

export async function listKV(query = ''): Promise<BaseResponse<{ items: KVItem[] }>> {
  const res = await axiosClient.get('/admin/kv/list', { params: { query } })
  return res.data
}

export async function setKV(item: KVItem): Promise<BaseResponse<null>> {
  const res = item.key
    ? await axiosClient.put(`/admin/kv/${encodeURIComponent(item.key)}`, item)
    : await axiosClient.post('/admin/kv', item)
  return res.data
}

export async function createKV(item: KVItem): Promise<BaseResponse<null>> {
  const res = await axiosClient.post('/admin/kv', item)
  return res.data
}

export async function deleteKV(key: string): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/admin/kv/${encodeURIComponent(key)}`)
  return res.data
}

export async function listOidcAdmin(): Promise<BaseResponse<OidcConfig[]>> {
  const res = await axiosClient.get('/admin/oidc/list')
  return res.data
}

export async function createOidcAdmin(config: Partial<OidcConfig>): Promise<BaseResponse<null>> {
  const res = await axiosClient.post('/admin/oidc/o', config)
  return res.data
}

export async function updateOidcAdmin(config: Partial<OidcConfig> & Pick<OidcConfig, 'id'>): Promise<BaseResponse<null>> {
  const res = await axiosClient.put(`/admin/oidc/o/${config.id}`, config)
  return res.data
}

export async function deleteOidcAdmin(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/admin/oidc/o/${id}`)
  return res.data
}
