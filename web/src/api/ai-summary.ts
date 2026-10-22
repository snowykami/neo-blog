import type { AISummaryBatchResult, AISummaryStatus } from '@/models/post'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

// 触发文章 AI 摘要生成（后台任务），同一文章同时只允许一个任务
export async function triggerAISummary(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.post(`/post/p/${id}/ai-summary`)
  return res.data
}

// 为全站文章批量创建 AI 摘要任务（仅管理员），已是最新的摘要会跳过；overwriteManual 为 true 时覆盖手动填写的描述
export async function triggerAISummaryBatch(overwriteManual: boolean): Promise<BaseResponse<AISummaryBatchResult>> {
  const res = await axiosClient.post('/post/ai-summary/batch', { overwriteManual })
  return res.data
}

// 查询文章 AI 摘要生成状态
export async function getAISummaryStatus(id: number): Promise<BaseResponse<AISummaryStatus>> {
  const res = await axiosClient.get(`/post/p/${id}/ai-summary`)
  return res.data
}
