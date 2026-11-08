import type { PaginationParams } from '@/models/common'
import type { NotificationItem, NotificationPreferences, NotificationType, NotificationUnreadCount } from '@/models/notification'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

// 通知列表；filter 为 all / unread，types 为空表示不限类型（前端 tab 传一组类型）
export async function listNotifications({
  filter = 'all',
  types,
  page = 1,
  size = 10,
}: {
  filter?: 'all' | 'unread'
  types?: NotificationType[]
} & Pick<PaginationParams, 'page' | 'size'>): Promise<BaseResponse<{ notifications: NotificationItem[], total: number }>> {
  const res = await axiosClient.get('/notifications', {
    params: { filter, type: types?.join(','), page, size },
  })
  return res.data
}

// 未读徽标：未读的聚合组数
export async function getUnreadNotificationCount(): Promise<BaseResponse<NotificationUnreadCount>> {
  const res = await axiosClient.get('/notifications/unread-count')
  return res.data
}

// 单条已读，幂等；聚合行会整组置已读
export async function markNotificationRead(id: number): Promise<BaseResponse<{ affected: number }>> {
  const res = await axiosClient.post(`/notifications/${id}/read`)
  return res.data
}

// 全部已读；beforeId 避免把请求期间新到的通知也标掉
export async function markAllNotificationsRead({ beforeId }: { beforeId?: number } = {}): Promise<BaseResponse<{ affected: number }>> {
  const res = await axiosClient.post('/notifications/read-all', { beforeId })
  return res.data
}

export async function getNotificationPreferences(): Promise<BaseResponse<NotificationPreferences>> {
  const res = await axiosClient.get('/notifications/preferences')
  return res.data
}

export async function updateNotificationPreferences({
  inapp,
  email,
  aiInteractions,
}: {
  inapp: NotificationType[]
  email: NotificationType[]
  aiInteractions: boolean
}): Promise<BaseResponse<NotificationPreferences>> {
  const res = await axiosClient.put('/notifications/preferences', { inapp, email, aiInteractions })
  return res.data
}

// 一键关掉全部通知邮件（站内通知不受影响）
export async function unsubscribeAllNotifications(): Promise<BaseResponse<NotificationPreferences>> {
  const res = await axiosClient.post('/notifications/preferences/unsubscribe-all')
  return res.data
}
