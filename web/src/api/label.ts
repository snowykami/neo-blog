import type { Label } from '@/models/label'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

export async function getLabels(): Promise<BaseResponse<{ labels: Label[] }>> {
  const res = await axiosClient.get<BaseResponse<{ labels: Label[] }>>('/label/list', {
  })
  return res.data
}


export async function createLabel({label}: {label: Omit<Label, "id">}): Promise<BaseResponse<{ id: number }>> {
  const res = await axiosClient.post<BaseResponse<{ id: number }>>('/label/l', {
    ...label,
  })
  return res.data
}

export async function updateLabel({label}: {label: Label & Pick<Label, "id">}): Promise<BaseResponse<null>> {
  const res = await axiosClient.put<BaseResponse<null>>(`/label/l/${label.id}`, {
    ...label,
  })
  return res.data
}

export async function deleteLabel({id}: {id: number}): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete<BaseResponse<null>>(`/label/l/${id}`, {
  })
  return res.data
}