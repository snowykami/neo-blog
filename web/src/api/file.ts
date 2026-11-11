import type { FileModel, StorageMigrationStatus, StorageProviderConfig, StorageProviderUsage } from '@/models/file'
import type { BaseResponse } from '@/models/resp'
import { CanceledError } from 'axios'
import { compressImage, DEFAULT_COMPRESS_LEVEL } from '@/utils/client/image-compress'
import axiosClient from './client'

/**
 * 上传文件
 * - 不使用全局 10 秒超时：上传耗时取决于文件大小与网速（视频可达 100MB），只能由调用方通过 signal 取消
 * - 取消：请求体还没发完时直接中断请求，服务端不会保存；已经发完时服务端可能正在保存，中断会留下拿不到 id 的孤儿文件，
 *   改为等响应回来后删掉刚保存的文件（每次上传都是新记录，删除不影响其他内容），再按取消抛出（调用方据 signal.aborted 判断）
 */
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
  if (signal?.aborted)
    throw new CanceledError()

  const formData = new FormData()
  formData.append('file', file)
  formData.append('name', name || file.name)
  formData.append('group', group || '')
  // 仅管理员可指定存储源，未指定时不传该字段
  if (providerId)
    formData.append('provider_id', providerId)

  const request = new AbortController()
  let sent = false
  const onAbort = () => {
    if (!sent)
      request.abort()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await axiosClient.post<BaseResponse<{ hash: string, id: number, url: string }>>('/file/f', formData, {
      signal: request.signal,
      timeout: 0,
      onUploadProgress: (event) => {
        if (!event.total)
          return
        if (event.loaded >= event.total)
          sent = true
        onProgress?.(Math.round((event.loaded / event.total) * 100))
      },
    })
    if (signal?.aborted) {
      void deleteFile({ id: res.data.data.id }).catch(() => {})
      throw new CanceledError()
    }
    return res.data
  }
  finally {
    signal?.removeEventListener('abort', onAbort)
  }
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
