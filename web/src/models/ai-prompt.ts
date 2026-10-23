import type { AIWriteMode } from './ai-write'

// 指令归属：平台指令（管理员维护，所有编辑者可用）/ 个人指令（仅自己可见）
export type AIPromptScope = 'platform' | 'user'

export interface AIPrompt {
  id: number
  scope: AIPromptScope
  mode: AIWriteMode
  label: string
  instruction: string
  editable: boolean // 当前用户能否编辑、删除
}
