import type { EditSessionTarget } from './edit-session'

// AI 写作模式：帮写（在光标处生成）/ 润色（改写选区）
export type AIWriteMode = 'write' | 'rewrite'

// 生成内容的位置：独立成块 / 段落中间 / 代码块内，与后端 dto.AIWriteReq.Scope 对应
export type AIWriteScope = 'block' | 'inline' | 'code'

export type AIWriteTarget = EditSessionTarget

// 快捷指令：与后端 aiWritePresets 的键一致
export const AI_WRITE_PRESETS = ['continue', 'summarize', 'outline', 'example'] as const
export const AI_REWRITE_PRESETS = ['polish', 'shorten', 'expand', 'formal', 'casual', 'translate_en', 'translate_zh'] as const
export type AIPreset = (typeof AI_WRITE_PRESETS)[number] | (typeof AI_REWRITE_PRESETS)[number]

export interface AIWriteRequest {
  mode: AIWriteMode
  scope: AIWriteScope
  // 快捷指令（对应后端 aiWritePresets），可与 instruction 同时提供
  preset?: AIPreset
  instruction: string
  // 编辑器当前正文 HTML，插入点 / 选区以标记文本表示
  document: string
  title: string
  description: string
  category: string
  labels: string[]
}

// 后端 SSE 事件：queued 排队、thinking 思考中、delta 内容片段、done 完成、error 出错、ping 心跳
export type AIWriteEvent
  = | { event: 'queued' | 'thinking' | 'done' | 'ping' }
    | { event: 'delta', text: string }
    | { event: 'error', message: string }
