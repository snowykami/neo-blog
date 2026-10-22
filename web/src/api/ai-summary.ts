import type { AISummaryStatus } from '@/models/post'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

// 触发文章 AI 摘要生成（后台任务），同一文章同时只允许一个任务
export async function triggerAISummary(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.post(`/post/p/${id}/ai-summary`)
  return res.data
}

// 查询文章 AI 摘要生成状态
export async function getAISummaryStatus(id: number): Promise<BaseResponse<AISummaryStatus>> {
  const res = await axiosClient.get(`/post/p/${id}/ai-summary`)
  return res.data
}
