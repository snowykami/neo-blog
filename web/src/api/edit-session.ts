import type { EditSession, EditSessionTarget } from '@/models/edit-session'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

// 保存正文时携带的编辑会话请求头，与后端 dto 中的 header 标签一致
export const EDIT_SESSION_HEADER = 'X-Edit-Session'

export function editSessionHeaders(sessionId?: string | null) {
  return sessionId ? { [EDIT_SESSION_HEADER]: sessionId } : undefined
}

// 开启编辑会话，并顶掉该文章/页面的旧编辑会话
export async function acquireEditSession({ target, id }: { target: EditSessionTarget, id: number }): Promise<BaseResponse<EditSession>> {
  const res = await axiosClient.post(`/${target}/p/${id}/edit-session`)
  return res.data
}

// 获取当前持有编辑会话的信息，isCurrent 表示传入的会话是否仍有效
export async function getEditSession({ target, id, sessionId }: { target: EditSessionTarget, id: number, sessionId?: string | null }): Promise<BaseResponse<EditSession | null>> {
  const res = await axiosClient.get(`/${target}/p/${id}/edit-session`, { headers: editSessionHeaders(sessionId) })
  return res.data
}

// 保存被拒绝：编辑会话已被其他设备/窗口接管
export function isEditSessionConflict(error: unknown) {
  return (error as { response?: { status?: number } })?.response?.status === 409
}
