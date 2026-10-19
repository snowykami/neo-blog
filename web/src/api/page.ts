import type { PaginationParams } from '@/models/common'
import type { PageModel } from '@/models/page'
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
