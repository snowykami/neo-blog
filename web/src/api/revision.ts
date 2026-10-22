import type { EditSessionTarget } from '@/models/edit-session'
import type { BaseResponse } from '@/models/resp'
import type { Revision, RevisionDetail } from '@/models/revision'
import axiosClient from './client'
import { editSessionHeaders } from './edit-session'

// 版本列表（新的在前，不含正文）
export async function listRevisions({ target, id, page = 1, size = 50 }: { target: EditSessionTarget, id: number, page?: number, size?: number }): Promise<BaseResponse<{ revisions: Revision[], total: number }>> {
  const res = await axiosClient.get(`/${target}/p/${id}/revisions`, { params: { page, size } })
  return res.data
}

// 版本详情（含正文与元信息）
export async function getRevision({ target, id, revisionId }: { target: EditSessionTarget, id: number, revisionId: number }): Promise<BaseResponse<RevisionDetail>> {
  const res = await axiosClient.get(`/${target}/p/${id}/revisions/${revisionId}`)
  return res.data
}

// 恢复为指定版本：写入草稿与元信息，不直接发布；需携带当前编辑会话
export async function restoreRevision({ target, id, revisionId, sessionId }: { target: EditSessionTarget, id: number, revisionId: number, sessionId: string | null }): Promise<BaseResponse<null>> {
  const res = await axiosClient.post(`/${target}/p/${id}/revisions/${revisionId}/restore`, null, { headers: editSessionHeaders(sessionId) })
  return res.data
}

// 放弃未发布的修改：草稿恢复为已发布的正文
export async function discardDraft({ target, id, sessionId }: { target: EditSessionTarget, id: number, sessionId: string | null }): Promise<BaseResponse<null>> {
  const res = await axiosClient.post(`/${target}/p/${id}/discard-draft`, null, { headers: editSessionHeaders(sessionId) })
  return res.data
}
