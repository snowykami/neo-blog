import type { Label } from '@/models/label'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

export async function getLabels(): Promise<BaseResponse<{ labels: Label[] }>> {
  const res = await axiosClient.get<BaseResponse<{ labels: Label[] }>>('/label/list', {
  })
  return res.data
}
