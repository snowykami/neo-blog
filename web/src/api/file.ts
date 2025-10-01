import { BaseResponse } from '@/models/resp'
import axiosClient from './client'

export async function uploadFile(
  {
    file,
    name,
    providerId,
    group,
  }: {
    file: File,
    name: string,
    providerId?: string,
    group?: string
  }
): Promise<BaseResponse<{
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
  formData.append('provider_id', providerId || '')
  const res = await axiosClient.post<BaseResponse<{
    hash: string,
    id: number,
  }>>('/file/f', formData, {
  })
  return res.data
}

export async function deleteFile({ id }: { id: number }): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/file/f/${id}`,)
  return res.data
}

export async function listFiles({ page, size, keywords, orderBy, desc }: { page: number, size: number, keywords?: string, orderBy?: string, desc?: boolean }): Promise<BaseResponse<{
  total: number,
  files: Array<FileModel>
}>> {
  const res = await axiosClient.get<BaseResponse<{
    total: number,
    files: Array<FileModel>
  }>>('/file/file-list', {
    params: {
      page,
      size,
      keywords,
      orderBy,
      desc,
    },
    withCredentials: true,
  })
  return res.data
}