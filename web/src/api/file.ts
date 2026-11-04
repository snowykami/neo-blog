import type { FileModel, StorageMigrationStatus, StorageProviderConfig, StorageProviderUsage } from '@/models/file'
import type { BaseResponse } from '@/models/resp'
import { compressImage, DEFAULT_COMPRESS_LEVEL } from '@/utils/client/image-compress'
import axiosClient from './client'

export async function uploadFile({
  file,
  name,
  providerId,
  group,
  compressLevel = DEFAULT_COMPRESS_LEVEL,
  onProgress,
  signal,
}: {
  file: File
  name?: string // 不传则使用 file.name
  providerId?: string
  group?: string
  compressLevel?: number // 0-10，0 不压缩
  onProgress?: (progress: number) => void // 上传进度 0-100
  signal?: AbortSignal
}): Promise<
  BaseResponse<{
    hash: string
    id: number
    url: string
  }>
> {
  if (typeof window === 'undefined') {
    throw new TypeError('uploadFile can only be used in the browser')
  }
  if (!file) {
    throw new Error('No file provided')
  }

  // 仅对 JPEG / PNG / WebP 图片且 compressLevel > 0 时压缩；界面预览过的会直接复用缓存的结果
  file = await compressImage(file, compressLevel)

  const formData = new FormData()
  formData.append('file', file)
  formData.append('name', name || file.name)
  formData.append('group', group || '')
  // 仅管理员可指定存储源，未指定时不传该字段
  if (providerId)
    formData.append('provider_id', providerId)
  const res = await axiosClient.post('/file/f', formData, {
    signal,
    onUploadProgress: onProgress
      ? event => event.total && onProgress(Math.round((event.loaded / event.total) * 100))
      : undefined,
  })
  return res.data
}

export async function deleteFile({ id }: { id: number }): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/file/f/${id}`)
  return res.data
}

export async function batchDeleteFiles({ ids }: { ids: number[] }): Promise<
  BaseResponse<{
    deleted_count: number
    failed_ids: number[]
  }>
> {
  const res = await axiosClient.delete('/file/batch', {
    params: { ids: ids.join(',') },
  })
  return res.data
}

export type FileTypeFilter = 'image' | 'video' | 'audio' | 'other'

export async function listFiles({
  page,
  size,
  query,
  orderBy,
  desc,
  type,
  scope,
}: {
  page: number
  size: number
  query?: string
  orderBy?: string
  desc?: boolean
  type?: FileTypeFilter // 按类型筛选，不传则不筛选
  scope?: 'mine' | 'all' // 默认仅本人文件，all 仅管理员可用
}): Promise<
  BaseResponse<{
    total: number
    files: Array<FileModel>
  }>
> {
  const res = await axiosClient.get('/file/file-list', {
    params: {
      page,
      size,
      query,
      orderBy,
      desc,
      type,
      scope,
    },
    withCredentials: true,
  })
  return res.data
}

export async function listStorageProviders(): Promise<
  BaseResponse<{
    providers: Array<StorageProviderConfig>
    usage: Record<string, StorageProviderUsage> // 键为存储提供者 ID
  }>
> {
  const res = await axiosClient.get('/file/provider-list', {
    withCredentials: true,
  })
  return res.data
}

export async function createStorageProvider({
  provider,
}: {
  provider: StorageProviderConfig
}): Promise<BaseResponse<null>> {
  const res = await axiosClient.post('/file/provider', provider, {
    withCredentials: true,
  })
  return res.data
}

export async function updateStorageProvider({
  provider,
}: {
  provider: StorageProviderConfig
}): Promise<BaseResponse<null>> {
  const res = await axiosClient.put(`/file/provider/${provider.id}`, provider, {
    withCredentials: true,
  })
  return res.data
}

export async function deleteStorageProvider({ id }: { id: number }): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/file/provider/${id}`, {
    withCredentials: true,
  })
  return res.data
}

export async function setDefaultStorageProvider({
  id,
}: {
  id: number
}): Promise<BaseResponse<null>> {
  const res = await axiosClient.put(
    `/file/provider/${id}/set-default`,
    {},
    {
      withCredentials: true,
    },
  )
  return res.data
}

// 发起存储迁移：迁移整个存储（sourceProviderId），或只迁移选中的文件（fileIds）
export async function startStorageMigration(req: {
  targetProviderId: number
  sourceProviderId?: number
  fileIds?: number[]
}): Promise<BaseResponse<StorageMigrationStatus>> {
  const res = await axiosClient.post('/file/migration', req)
  return res.data
}

export async function getStorageMigration(): Promise<BaseResponse<{ migration: StorageMigrationStatus | null }>> {
  const res = await axiosClient.get('/file/migration')
  return res.data
}

export async function cancelStorageMigration(): Promise<BaseResponse<null>> {
  const res = await axiosClient.post('/file/migration/cancel')
  return res.data
}
