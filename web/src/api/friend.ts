import type {
  AdminFriendSortOverview,
  AdminListFriendLinksData,
  AdminReviewFriendLinkPayload,
  AdminUpdateFriendSettingsPayload,
  AdminUpsertFriendGroupPayload,
  AdminUpsertFriendLinkPayload,
  FriendAdminSettings,
  FriendAutofillResult,
  FriendGroupAdmin,
  FriendLinkAdmin,
  FriendLinkMine,
  FriendSortMode,
  MyFriendLinksData,
  PublicFriendsData,
  UpsertMyFriendLinkPayload,
} from '@/models/friend'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

export async function getPublicFriends(group?: string, sort?: FriendSortMode): Promise<BaseResponse<PublicFriendsData>> {
  const params: Record<string, string> = {}
  if (group)
    params.group = group
  if (sort)
    params.sort = sort
  const res = await axiosClient.get<BaseResponse<PublicFriendsData>>('/friends', {
    params: Object.keys(params).length > 0 ? params : undefined,
  })
  return res.data
}

export async function listMyFriendLinks(): Promise<BaseResponse<MyFriendLinksData>> {
  const res = await axiosClient.get<BaseResponse<MyFriendLinksData>>('/friends/mine')
  return res.data
}

export async function autofillFriendLink(url: string): Promise<BaseResponse<FriendAutofillResult>> {
  const res = await axiosClient.post<BaseResponse<FriendAutofillResult>>('/friends/autofill', { url })
  return res.data
}

export async function createMyFriendLink(payload: UpsertMyFriendLinkPayload): Promise<BaseResponse<FriendLinkMine>> {
  const res = await axiosClient.post<BaseResponse<FriendLinkMine>>('/friends', payload)
  return res.data
}

export async function updateMyFriendLink(id: number, payload: UpsertMyFriendLinkPayload): Promise<BaseResponse<FriendLinkMine>> {
  const res = await axiosClient.put<BaseResponse<FriendLinkMine>>(`/friends/${id}`, payload)
  return res.data
}

export async function deleteMyFriendLink(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete<BaseResponse<null>>(`/friends/${id}`)
  return res.data
}

// ============================================================================
// 管理员后台接口
// ============================================================================

export async function adminListFriendGroups(): Promise<BaseResponse<{ groups: FriendGroupAdmin[] }>> {
  const res = await axiosClient.get<BaseResponse<{ groups: FriendGroupAdmin[] }>>('/admin/friends/groups')
  return res.data
}

export async function adminCreateFriendGroup(payload: AdminUpsertFriendGroupPayload): Promise<BaseResponse<FriendGroupAdmin>> {
  const res = await axiosClient.post<BaseResponse<FriendGroupAdmin>>('/admin/friends/groups', payload)
  return res.data
}

export async function adminUpdateFriendGroup(id: number, payload: AdminUpsertFriendGroupPayload): Promise<BaseResponse<FriendGroupAdmin>> {
  const res = await axiosClient.put<BaseResponse<FriendGroupAdmin>>(`/admin/friends/groups/${id}`, payload)
  return res.data
}

export async function adminReorderFriendGroups(ids: number[]): Promise<BaseResponse<null>> {
  const res = await axiosClient.put<BaseResponse<null>>('/admin/friends/groups/reorder', { ids })
  return res.data
}

export async function adminGetFriendSortOverview(): Promise<BaseResponse<AdminFriendSortOverview>> {
  const res = await axiosClient.get<BaseResponse<AdminFriendSortOverview>>('/admin/friends/sort')
  return res.data
}

export async function adminUpdateFriendSortMode(sortMode: FriendSortMode): Promise<BaseResponse<{ sortMode: FriendSortMode }>> {
  const res = await axiosClient.put<BaseResponse<{ sortMode: FriendSortMode }>>('/admin/friends/sort-mode', { sortMode })
  return res.data
}

export async function adminGetFriendSettings(): Promise<BaseResponse<FriendAdminSettings>> {
  const res = await axiosClient.get<BaseResponse<FriendAdminSettings>>('/admin/friends/settings')
  return res.data
}

export async function adminUpdateFriendSettings(payload: AdminUpdateFriendSettingsPayload): Promise<BaseResponse<FriendAdminSettings>> {
  const res = await axiosClient.put<BaseResponse<FriendAdminSettings>>('/admin/friends/settings', payload)
  return res.data
}

export async function adminReorderFriendLinks(groupId: number, ids: number[]): Promise<BaseResponse<null>> {
  const res = await axiosClient.put<BaseResponse<null>>('/admin/friends/links/reorder', { groupId, ids })
  return res.data
}

export async function adminDeleteFriendGroup(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete<BaseResponse<null>>(`/admin/friends/groups/${id}`)
  return res.data
}

export async function adminListFriendLinks(params: {
  page?: number
  pageSize?: number
  status?: string
  groupId?: number
  keyword?: string
}): Promise<BaseResponse<AdminListFriendLinksData>> {
  const res = await axiosClient.get<BaseResponse<AdminListFriendLinksData>>('/admin/friends/links', { params })
  return res.data
}

export async function adminCreateFriendLink(payload: AdminUpsertFriendLinkPayload): Promise<BaseResponse<FriendLinkAdmin>> {
  const res = await axiosClient.post<BaseResponse<FriendLinkAdmin>>('/admin/friends/links', payload)
  return res.data
}

export async function adminUpdateFriendLink(id: number, payload: AdminUpsertFriendLinkPayload): Promise<BaseResponse<FriendLinkAdmin>> {
  const res = await axiosClient.put<BaseResponse<FriendLinkAdmin>>(`/admin/friends/links/${id}`, payload)
  return res.data
}

export async function adminReviewFriendLink(id: number, payload: AdminReviewFriendLinkPayload): Promise<BaseResponse<FriendLinkAdmin>> {
  const res = await axiosClient.post<BaseResponse<FriendLinkAdmin>>(`/admin/friends/links/${id}/review`, payload)
  return res.data
}

export async function adminTransferFriendLink(id: number, userId: number): Promise<BaseResponse<FriendLinkAdmin>> {
  const res = await axiosClient.put<BaseResponse<FriendLinkAdmin>>(`/admin/friends/links/${id}/transfer`, { userId })
  return res.data
}

export async function adminDeleteFriendLink(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete<BaseResponse<null>>(`/admin/friends/links/${id}`)
  return res.data
}

export async function adminProbeFriendLink(id: number): Promise<BaseResponse<FriendLinkAdmin>> {
  const res = await axiosClient.post<BaseResponse<FriendLinkAdmin>>(`/admin/friends/links/${id}/probe`)
  return res.data
}

export async function adminProbeAllFriendLinks(): Promise<BaseResponse<null>> {
  const res = await axiosClient.post<BaseResponse<null>>('/admin/friends/probe')
  return res.data
}
