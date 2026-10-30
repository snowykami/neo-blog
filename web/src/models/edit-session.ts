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
