import type { FileModel, StorageProviderConfig } from '@/models/file'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

export async function uploadFile({
  file,
  name,
  providerId,
  group,
  compressLevel = 5,
}: {
  file: File
  name?: string // 不传则使用 file.name
  providerId?: string
  group?: string
  compressLevel?: number // 0-10，0 不压缩
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

  // 仅对图片类型文件有效，且 compressLevel > 0 时压缩
  const level = Math.min(Math.max(Math.round(compressLevel ?? 0), 0), 10)
  if (level > 0 && file.type.startsWith('image/')) {
    const imageBitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const MAX_WIDTH = 1920
      const scale = Math.min(1, MAX_WIDTH / imageBitmap.width)
      canvas.width = Math.round(imageBitmap.width * scale)
      canvas.height = Math.round(imageBitmap.height * scale)
      ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height)

      // 把 compressLevel 映射为质量（level 越大 -> quality 越小 -> 文件更小）
      // 并限制质量范围，避免过度失真
      const quality = Math.max(0.1, 1 - level / 10) // level=10 -> 0.1, level=1 -> 0.9

      // 输出类型策略：
      // - 若原始是 PNG 且需要有损压缩，建议转为 webp（支持透明）
      // - 对于 jpeg/webp 保留原类型
      const outputType = file.type === 'image/png' ? 'image/webp' : file.type

      const blob: Blob | null = await new Promise((resolve) => {
        canvas.toBlob(
          b => resolve(b),
          outputType,
          quality,
        )
      })
      if (blob) {
        const ext = blob.type.split('/')[1] || file.name.split('.').pop()
        file = new File([blob], file.name.replace(/\.[^/.]+$/, '') + (ext ? `.${ext}` : ''), { type: blob.type })
      }
    }
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('name', name || file.name)
  formData.append('group', group || '')
  formData.append('provider_id', providerId || '')
  const res = await axiosClient.post('/file/f', formData, {})
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

export async function listFiles({
  page,
  size,
  keywords,
  orderBy,
  desc,
}: {
  page: number
  size: number
  keywords?: string
  orderBy?: string
  desc?: boolean
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
      keywords,
      orderBy,
      desc,
    },
    withCredentials: true,
  })
  return res.data
}

export async function listStorageProviders(): Promise<
  BaseResponse<{
    providers: Array<StorageProviderConfig>
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
