import { BaseResponse } from '@/models/resp'
import axiosClient from './client'

export async function uploadFile({ file, name, group }: { file: File, name?: string, group?: string }): Promise<BaseResponse<{
  hash: string,
  id: number,
}>> {
  if (typeof window === 'undefined') {
    throw new Error('uploadFile can only be used in the browser')
  }
  if (!file) {
    throw new Error('No file provided')
  }
  const formData = new FormData()
  formData.append('file', file)
  formData.append('name', name || file.name)
  formData.append('group', group || '')
  const res = await axiosClient.post<BaseResponse<{
    hash: string,
    id: number,
  }>>('/file/f', formData, {
    withCredentials: true,
  })
  return res.data
}