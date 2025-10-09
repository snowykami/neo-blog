import type { FileModel, StorageProviderConfig } from '@/models/file'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

export async function uploadFile(
  {
    file,
    name,
    providerId,
    group,
  }: {
    file: File
    name?: string // 不传则使用 file.name
    providerId?: string
    group?: string
  },
): Promise<BaseResponse<{
  hash: string
  id: number
  url: string
}>> {
  if (typeof window === 'undefined') {
    throw new TypeError('uploadFile can only be used in the browser')
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
    hash: string
    id: number
    url: string
  }>>('/file/f', formData, {
  })
  return res.data
}

export async function deleteFile({ id }: { id: number }): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/file/f/${id}`)
  return res.data
}

export async function batchDeleteFiles({ ids }: { ids: number[] }): Promise<BaseResponse<{
  deleted_count: number
  failed_ids: number[]
}>> {
  const res = await axiosClient.delete<BaseResponse<{
    deleted_count: number
    failed_ids: number[]
  }>>('/file/batch', {
    params: { ids: ids.join(',') },
  })
  return res.data
}

export async function listFiles({ page, size, keywords, orderBy, desc }: { page: number, size: number, keywords?: string, orderBy?: string, desc?: boolean }): Promise<BaseResponse<{
  total: number
  files: Array<FileModel>
}>> {
  const res = await axiosClient.get<BaseResponse<{
    total: number
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

export async function listStorageProviders(): Promise<BaseResponse<{
  providers: Array<StorageProviderConfig>
}>> {
  const res = await axiosClient.get<BaseResponse<{
    providers: Array<StorageProviderConfig>
  }>>('/file/provider-list', {
    withCredentials: true,
  })
  return res.data
}

export async function createStorageProvider({ provider }: { provider: StorageProviderConfig }): Promise<BaseResponse<null>> {
  const res = await axiosClient.post<BaseResponse<null>>('/file/provider', provider, {
    withCredentials: true,
  })
  return res.data
}

export async function updateStorageProvider({ provider }: { provider: StorageProviderConfig }): Promise<BaseResponse<null>> {
  const res = await axiosClient.put<BaseResponse<null>>(`/file/provider/${provider.id}`, provider, {
    withCredentials: true,
  })
  return res.data
}

export async function deleteStorageProvider({ id }: { id: number }): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete<BaseResponse<null>>(`/file/provider/${id}`, {
    withCredentials: true,
  })
  return res.data
}

export async function setDefaultStorageProvider({ id }: { id: number }): Promise<BaseResponse<null>> {
  const res = await axiosClient.put<BaseResponse<null>>(`/file/provider/${id}/set-default`, {}, {
    withCredentials: true,
  })
  return res.data
}
