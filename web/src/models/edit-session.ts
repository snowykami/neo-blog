import type { User } from './user'

// 编辑会话目标：与后端 constant.TargetTypePost / TargetTypePage 对应
export type EditSessionTarget = 'post' | 'page'

export interface EditSession {
  sessionId?: string // 仅申请会话时返回
  user: User // 当前持有编辑会话的用户
  os: string
  browser: string
  startedAt: string
  isCurrent: boolean // 请求方携带的会话是否仍是当前会话
  baseRevisionId?: number // 打开编辑器时的版本（编辑起点），仅申请会话时返回
  apiTokenName?: string // 会话由个人 API Token（外部 AI 工具）开启时为 Token 名称
}

// 编辑事件（SSE），与后端 service.EditEvent 对应；事件不携带正文，收到后比较草稿版本号再自行拉取
// ready：连接（或重连）成功，断开期间可能错过了事件；resync：后端可能错过了其他实例的事件
export type EditEventType = 'ready' | 'saved' | 'session' | 'resync'

export interface EditEvent {
  type: EditEventType
  draftVersion?: number // 保存事件：保存后的草稿版本号
  apiTokenName?: string // 保存事件：外部 AI 工具写入时的 Token 名称
}

// 保存文章 / 页面的结果，draftVersion 为保存后的草稿版本号
export interface ContentSaveResult {
  id: number
  draftVersion: number
}
