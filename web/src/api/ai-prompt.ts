import type { AIPrompt, AIPromptScope } from '@/models/ai-prompt'
import type { AIWriteMode } from '@/models/ai-write'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

export interface AIPromptInput {
  scope?: AIPromptScope // 仅新增时有效，平台指令只有管理员可以新增
  mode: AIWriteMode
  label: string
  instruction: string
}

// 当前用户可用的 AI 指令：平台指令 + 自己的个人指令
export async function listAIPrompts(): Promise<BaseResponse<AIPrompt[]>> {
  const res = await axiosClient.get('/ai-prompt/list')
  return res.data
}

export async function createAIPrompt(input: AIPromptInput): Promise<BaseResponse<AIPrompt>> {
  const res = await axiosClient.post('/ai-prompt/p', input)
  return res.data
}

export async function updateAIPrompt(id: number, input: AIPromptInput): Promise<BaseResponse<AIPrompt>> {
  const res = await axiosClient.put(`/ai-prompt/p/${id}`, input)
  return res.data
}

export async function deleteAIPrompt(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/ai-prompt/p/${id}`)
  return res.data
}
