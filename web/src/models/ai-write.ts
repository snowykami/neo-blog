import type { EditSessionTarget } from './edit-session'

// AI 写作模式：帮写（在光标处生成）/ 润色（改写选区）
export type AIWriteMode = 'write' | 'rewrite'

// 生成内容的位置：独立成块 / 段落中间 / 代码块内，与后端 dto.AIWriteReq.Scope 对应
export type AIWriteScope = 'block' | 'inline' | 'code'

export type AIWriteTarget = EditSessionTarget

// 使用的快捷指令（AI 指令）：id 发给后端，label 用于界面展示
export interface AIPromptRef {
  id: number
  label: string
}

export interface AIWriteRequest {
  mode: AIWriteMode
  scope: AIWriteScope
  // 快捷指令（AI 指令）ID，可与 instruction 同时提供
  promptId?: number
  instruction: string
  // 编辑器当前正文 HTML，插入点 / 选区以标记文本表示
  document: string
  // 润色：选区的格式化表示（块结构为 Markdown、行内格式为 HTML 标签，图片等节点为 [[KEEP_n]] 占位符）
  selection?: string
  // 独立成块的帮写：可用组件说明（名称、用途与 props 的 JSON Schema），模型可按说明输出组件代码块
  components?: string
  // 是否附带全文作为上下文；不附带时润色只发送选中内容，帮写只发送插入点附近的片段
  includeContext: boolean
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
