import type { PaginationParams } from '../models/common'
import type { Comment } from '@/models/comment'
import type { ConfigSchema } from '@/models/config'
import type { Dashboard, DashboardDays } from '@/models/dashboard'
import type { ErrorEvent, ErrorEventSummary, ErrorIssue, ErrorIssueDetail, ErrorKind, ErrorReportStats, ErrorSource, ErrorStatus } from '@/models/error-report'
import type { OidcConfig } from '@/models/oidc-config'
import type { Post } from '@/models/post'
import type { BaseResponse } from '@/models/resp'
import type { Role, User } from '@/models/user'
import type { VisitDetail, VisitInsights, VisitLog, Visitor, VisitStats, VisitTrust } from '@/models/visit'
import axiosClient from './client'

export async function getDashboard(days: DashboardDays): Promise<BaseResponse<Dashboard>> {
  const res = await axiosClient.get('/admin/dashboard', { params: { days } })
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

/** 首页上的全部置顶文章（含私密文章），后置顶的在前 */
export async function listPinnedPostsAdmin(): Promise<BaseResponse<{ posts: Post[], limit: number }>> {
  const res = await axiosClient.get('/admin/posts/pinned')
  return res.data
}

/** 置顶到首页或取消置顶；pinnedUntil 为空表示不自动取消。首页已满时返回 pinned_posts_limit */
export async function setPostPin({ id, pinned, pinnedUntil = null }: { id: number, pinned: boolean, pinnedUntil?: string | null }): Promise<BaseResponse<Post>> {
  const res = await axiosClient.put(`/admin/posts/${id}/pin`, { pinned, pinnedUntil })
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

// 全局配置表单的结构与当前值（含环境变量设置的值）
export async function getConfigSchema(): Promise<BaseResponse<ConfigSchema>> {
  const res = await axiosClient.get('/admin/config')
  return res.data
}

// 保存全局配置，只提交改动的项；后端按注册表校验类型与取值范围
export async function saveConfig(items: { key: string, value: unknown }[]): Promise<BaseResponse<null>> {
  const res = await axiosClient.put('/admin/config', { items })
  return res.data
}

// 发送测试邮件：只传当前表单里改动过的 SMTP 字段，未填的由后端取已保存的配置，不会写入数据库
export interface SendTestEmailParams {
  host?: string
  port?: number
  ssl?: boolean
  username?: string
  password?: string
  address?: string
  to?: string
}

export async function sendTestEmail(params: SendTestEmailParams): Promise<BaseResponse<{ to: string }>> {
  const res = await axiosClient.post('/admin/config/email/test', params, { timeout: 60000 })
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
  action,
  visitorId,
  targetType,
  targetId,
  source,
  sourceHost,
  trust,
  country,
  device,
  ...pagination
}: {
  kind?: 'all' | 'user' | 'anonymous'
  action?: 'visit' | 'interaction' // 为空时访问与互动都返回
  visitorId?: number
  targetType?: string
  targetId?: number
  source?: string // 按来源筛选
  sourceHost?: string // 来源为其他网站时按域名筛选
  trust?: VisitTrust // 按可信度结论筛选
  country?: string // 按推断国家筛选
  device?: string // 按设备类型筛选
} & PaginationParams): Promise<BaseResponse<{ visits: VisitLog[], total: number }>> {
  const res = await axiosClient.get('/admin/visits', { params: { ...pagination, kind, action, visitorId, targetType, targetId, source, sourceHost, trust, country, device } })
  return res.data
}

export async function getVisitDetailAdmin(id: number): Promise<BaseResponse<VisitDetail>> {
  const res = await axiosClient.get(`/admin/visits/${id}`)
  return res.data
}

// days：1 为今日（按小时），7 / 30 按天
export async function getVisitInsightsAdmin(days: 1 | 7 | 30): Promise<BaseResponse<VisitInsights>> {
  const res = await axiosClient.get('/admin/visits/insights', { params: { days } })
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

// 错误报告：问题列表（按状态、来源、类型筛选；q 匹配标题、出错位置或事件 ID）
export async function listErrorIssuesAdmin({ status, source, kind, q, ...pagination }: {
  status?: ErrorStatus
  source?: ErrorSource
  kind?: ErrorKind
  q?: string
} & PaginationParams): Promise<BaseResponse<{ issues: ErrorIssue[], total: number }>> {
  const res = await axiosClient.get('/admin/errors', { params: { ...pagination, status, source, kind, q } })
  return res.data
}

export async function getErrorStatsAdmin(): Promise<BaseResponse<ErrorReportStats>> {
  const res = await axiosClient.get('/admin/errors/stats')
  return res.data
}

export async function getErrorIssueAdmin(id: number): Promise<BaseResponse<ErrorIssueDetail>> {
  const res = await axiosClient.get(`/admin/errors/${id}`)
  return res.data
}

export async function listErrorEventsAdmin(issueId: number, pagination: PaginationParams): Promise<BaseResponse<{ events: ErrorEventSummary[], total: number }>> {
  const res = await axiosClient.get(`/admin/errors/${issueId}/events`, { params: pagination })
  return res.data
}

export async function getErrorEventAdmin(id: number): Promise<BaseResponse<ErrorEvent>> {
  const res = await axiosClient.get(`/admin/error-events/${id}`)
  return res.data
}

export async function updateErrorIssueStatusAdmin(id: number, status: ErrorStatus): Promise<BaseResponse<null>> {
  const res = await axiosClient.put(`/admin/errors/${id}/status`, { status })
  return res.data
}

export async function deleteErrorIssueAdmin(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/admin/errors/${id}`)
  return res.data
}
