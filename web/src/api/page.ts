import type { PaginationParams } from '@/models/common'
import type { ContentSaveResult } from '@/models/edit-session'
import type { PageHtmlVersion, PageModel } from '@/models/page'
import type { BaseResponse } from '@/models/resp'
import { OrderBy } from '@/models/common'
import axiosClient from './client'
import { editSessionHeaders } from './edit-session'

// 前台读取页面：不带登录身份，只拿到公开页面的已发布内容（私密页面 404）
export async function getPageById({ id }: { id: string }): Promise<BaseResponse<PageModel | null>> {
  const res = await axiosClient.get(`/page/p/${id}`)
  return res.data
}

// 后台读取页面（编辑器、HTML 页面管理）：含私密页面与草稿，仅作者本人与管理员；前台页面不要用
export async function getPageForEdit({ id }: { id: string }): Promise<BaseResponse<PageModel>> {
  const res = await axiosClient.get(`/page/p/${id}/draft`)
  return res.data
}

// 前台页面列表（导航等）：只含公开页面，不论谁在看；后台管理用 listMyPages / listPagesAdmin
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

// 后台「我的页面」：当前用户自己的全部页面（含私密页面）
export async function listMyPages({
  page = 1,
  size = 10,
  orderBy = OrderBy.CreatedAt,
  desc = true,
  query = '',
  noContent = false,
}: { query?: string, noContent?: boolean } & PaginationParams): Promise<BaseResponse<{ pages: PageModel[], total: number }>> {
  const res = await axiosClient.get('/page/mine', {
    params: { page, size, orderBy, desc, query, noContent },
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
  page: Partial<PageModel> & Pick<PageModel, 'id'> & { baseDraftVersion?: number }
  editSessionId?: string | null // 保存正文时携带，见 api/edit-session.ts
}): Promise<BaseResponse<ContentSaveResult>> {
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
