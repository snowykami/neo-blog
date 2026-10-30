import type { PaginationParams } from '@/models/common'
import type { PageHtmlVersion, PageModel } from '@/models/page'
import type { BaseResponse } from '@/models/resp'
import { OrderBy } from '@/models/common'
import axiosClient from './client'
import { editSessionHeaders } from './edit-session'

export async function getPageById({
  id,
  type = 'normal',
}: {
  id: string
  type?: 'draft' | 'normal'
}): Promise<BaseResponse<PageModel | null>> {
  const res = await axiosClient.get(`/page/p/${id}`, {
    params: { type },
  })
  return res.data
}

export async function listPages({
  page = 1,
  size = 10,
  orderBy = OrderBy.CreatedAt,
  desc = true,
  query = '',
  noContent = false,
  onlyNav = false,
  userId = 0,
}: {
  query?: string
  noContent?: boolean
  onlyNav?: boolean
  userId?: number
} & PaginationParams): Promise<BaseResponse<{ pages: PageModel[], total: number }>> {
  const res = await axiosClient.get('/page/list', {
    params: {
      page,
      size,
      orderBy,
      desc,
      query,
      noContent,
      onlyNav,
      userId,
    },
  })
  return res.data
}

export async function createPage({
  page,
}: {
  page: Partial<Omit<PageModel, 'id' | 'createdAt' | 'updatedAt' | 'user' | 'userId'>>
}): Promise<BaseResponse<{ id: number }>> {
  const res = await axiosClient.post('/page/p', page)
  return res.data
}

export async function updatePage({
  page,
  editSessionId,
}: {
  page: Partial<PageModel> & Pick<PageModel, 'id'>
  editSessionId?: string | null // 保存正文时携带，见 api/edit-session.ts
}): Promise<BaseResponse<{ id: number }>> {
  const res = await axiosClient.put(`/page/p/${page.id}`, page, { headers: editSessionHeaders(editSessionId) })
  return res.data
}

export async function deletePage({ id }: { id: number }): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/page/p/${id}`)
  return res.data
}

// HTML 页面：上传单个 .html 文件或 .zip 包，创建新版本并立即生效（仅管理员）
export async function uploadPageHtml({
  pageId,
  file,
  onProgress,
  signal,
}: {
  pageId: number
  file: File
  onProgress?: (progress: number) => void // 上传进度 0-100
  signal?: AbortSignal
}): Promise<BaseResponse<PageHtmlVersion>> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await axiosClient.post(`/page/p/${pageId}/html/versions`, formData, {
    signal,
    // 文件包可能较大，解压与写入存储也需要时间，不使用默认的 10 秒超时
    timeout: 0,
    onUploadProgress: onProgress
      ? event => event.total && onProgress(Math.round((event.loaded / event.total) * 100))
      : undefined,
  })
  return res.data
}

export async function listPageHtmlVersions({ pageId }: { pageId: number }): Promise<BaseResponse<{ versions: PageHtmlVersion[] }>> {
  const res = await axiosClient.get(`/page/p/${pageId}/html/versions`)
  return res.data
}

// 修改版本的入口文件，或切换为页面当前生效的版本
export async function updatePageHtmlVersion({
  pageId,
  versionId,
  entry,
  active,
}: {
  pageId: number
  versionId: number
  entry?: string
  active?: boolean
}): Promise<BaseResponse<PageHtmlVersion>> {
  const res = await axiosClient.put(`/page/p/${pageId}/html/versions/${versionId}`, { entry, active })
  return res.data
}
