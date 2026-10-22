import type { PaginationParams } from '../models/common'
import type { Comment } from '@/models/comment'
import type { OidcConfig } from '@/models/oidc-config'
import type { Post } from '@/models/post'
import type { BaseResponse } from '@/models/resp'
import type { Role, User } from '@/models/user'
import type { VisitLog, Visitor, VisitStats } from '@/models/visit'
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

export type UserStatusFilter = 'active' | 'disabled'

export interface ListUsersAdminParams extends PaginationParams {
  keyword?: string // 按用户名、昵称、邮箱模糊搜索
  role?: Role | '' // 为空表示全部角色
  status?: UserStatusFilter | '' // 为空表示全部状态
}

export async function listUsers(params: ListUsersAdminParams): Promise<BaseResponse<{ users: User[], total: number }>> {
  const res = await axiosClient.get(
    '/admin/users',
    { params },
  )
  return res.data
}

export interface AdminUserDetail {
  user: User
  postCount: number
  pageCount: number
  commentCount: number
}

export async function getUserAdmin(id: number): Promise<BaseResponse<AdminUserDetail>> {
  const res = await axiosClient.get(`/admin/users/${id}`)
  return res.data
}

export interface CreateUserAdminReq {
  username: string
  nickname: string
  email: string
  password: string
  role: Role
}

export async function createUserAdmin(data: CreateUserAdminReq): Promise<BaseResponse<User>> {
  const res = await axiosClient.post('/admin/users', data)
  return res.data
}

export interface UpdateUserAdminReq {
  id: number
  username: string
  nickname: string
  email: string
  avatarUrl: string
  backgroundUrl: string
  gender: string
}

export async function updateUserAdmin({ id, ...data }: UpdateUserAdminReq): Promise<BaseResponse<null>> {
  const res = await axiosClient.put(`/admin/users/${id}`, data)
  return res.data
}

export async function updateUserRoleAdmin(id: number, role: Role): Promise<BaseResponse<null>> {
  const res = await axiosClient.put(`/admin/users/${id}/role`, { role })
  return res.data
}

export async function updateUserStatusAdmin(id: number, disabled: boolean): Promise<BaseResponse<null>> {
  const res = await axiosClient.put(`/admin/users/${id}/status`, { disabled })
  return res.data
}

export async function resetUserPasswordAdmin(id: number, newPassword: string): Promise<BaseResponse<null>> {
  const res = await axiosClient.put(`/admin/users/${id}/password`, { newPassword })
  return res.data
}

export async function deleteUserAdmin(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/admin/users/${id}`)
  return res.data
}

export async function listCommentsAdmin(pagination: PaginationParams, query: string): Promise<BaseResponse<{ comments: Comment[], total: number }>> {
  const res = await axiosClient.get(
    '/admin/comments',
    { params: { ...pagination, query } },
  )
  return res.data
}

export async function listPostsAdmin({
  query = '',
  userId = 0,
  ...pagination
}: {
  query?: string // 搜索查询，逗号分割
  userId?: number // 指定用户ID，为 0 时列出所有用户的文章
} & PaginationParams): Promise<BaseResponse<{ posts: Post[], total: number }>> {
  const res = await axiosClient.get(
    '/admin/posts',
    { params: { ...pagination, query, userId } },
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

export async function listVisitsAdmin({
  kind = 'all',
  visitorId,
  targetType,
  targetId,
  source,
  sourceHost,
  ...pagination
}: {
  kind?: 'all' | 'user' | 'anonymous'
  visitorId?: number
  targetType?: string
  targetId?: number
  source?: string // 按来源筛选
  sourceHost?: string // 来源为其他网站时按域名筛选
} & PaginationParams): Promise<BaseResponse<{ visits: VisitLog[], total: number }>> {
  const res = await axiosClient.get('/admin/visits', { params: { ...pagination, kind, visitorId, targetType, targetId, source, sourceHost } })
  return res.data
}

export async function getVisitStatsAdmin(): Promise<BaseResponse<VisitStats>> {
  const res = await axiosClient.get('/admin/visits/stats')
  return res.data
}

export async function getVisitorAdmin(id: number): Promise<BaseResponse<Visitor>> {
  const res = await axiosClient.get(`/admin/visitors/${id}`)
  return res.data
}
