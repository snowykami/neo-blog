import type { EditEvent, EditEventType, EditSession, EditSessionTarget } from '@/models/edit-session'
import type { BaseResponse } from '@/models/resp'
import { snakeToCamelObj } from 'field-conv'
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

const EDIT_EVENT_TYPES = new Set<string>(['ready', 'saved', 'session', 'resync'])

function parseEditEvent(message: string): EditEvent | null {
  let type = ''
  let data = ''
  for (const line of message.split('\n')) {
    if (line.startsWith('event:'))
      type = line.slice(6).trim()
    else if (line.startsWith('data:'))
      data += line.slice(5).trim()
  }
  // 心跳是注释行（以 : 开头），没有事件名，直接忽略
  if (!EDIT_EVENT_TYPES.has(type))
    return null
  let payload: Partial<EditEvent> = {}
  try {
    payload = data ? snakeToCamelObj(JSON.parse(data)) as Partial<EditEvent> : {}
  }
  catch {
    payload = {}
  }
  return { type: type as EditEventType, draftVersion: payload.draftVersion, apiTokenName: payload.apiTokenName }
}

/**
 * 订阅编辑事件（SSE）：逐个回调事件，连接结束时返回，由调用方负责重连
 * 无权限等错误按 axios 错误抛出；通过 signal 取消
 */
export async function streamEditEvents({ target, id, signal, onEvent }: {
  target: EditSessionTarget
  id: number
  signal: AbortSignal
  onEvent: (event: EditEvent) => void
}): Promise<void> {
  const res = await axiosClient.get(`/${target}/p/${id}/edit-events`, {
    adapter: 'fetch',
    responseType: 'stream',
    // 长连接，不使用默认超时
    timeout: 0,
    signal,
  })
  const stream = res.data
  if (!(stream instanceof ReadableStream))
    return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done)
      return
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n')
    let index = buffer.indexOf('\n\n')
    while (index >= 0) {
      const event = parseEditEvent(buffer.slice(0, index))
      buffer = buffer.slice(index + 2)
      if (event)
        onEvent(event)
      index = buffer.indexOf('\n\n')
    }
  }
}

// 保存被拒绝：草稿在读取之后被他人（外部 AI 工具）改动过，需要合并最新草稿后重新保存
export function isDraftConflict(error: unknown) {
  const response = (error as { response?: { status?: number, data?: { message?: unknown } } })?.response
  return response?.status === 409 && response.data?.message === 'draft_conflict'
}

// 保存被拒绝：编辑会话已被其他设备/窗口接管
// 409 也可能是 slug 冲突等其他冲突，后端返回了 message 时按 message 区分
export function isEditSessionConflict(error: unknown) {
  const response = (error as { response?: { status?: number, data?: { message?: unknown } } })?.response
  if (response?.status !== 409)
    return false
  const message = response.data?.message
  return typeof message !== 'string' || !message || message === 'edit_session_taken_over'
}
