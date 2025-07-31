import axiosClient from './client'
import { CreateCommentRequest, UpdateCommentRequest, Comment } from '@/models/comment'
import type {  PaginationParams } from '@/models/common'
import { OrderBy } from '@/models/common'
import type { BaseResponse } from '@/models/resp'


export async function createComment(
  data: CreateCommentRequest,
): Promise<BaseResponse<Comment>> {
  const res = await axiosClient.post<BaseResponse<Comment>>('/comment/c', data)
  return res.data
}

export async function updateComment(
  data: UpdateCommentRequest,
): Promise<BaseResponse<Comment>> {
  const res = await axiosClient.put<BaseResponse<Comment>>(`/comment/c/${data.id}`, data)
  return res.data
}

export async function deleteComment(id: number): Promise<void> {
  await axiosClient.delete(`/comment/c/${id}`)
}

export async function listComments(
  targetType: 'post' | 'page',
  targetId: number,
  pagination: PaginationParams = { orderBy: OrderBy.CreatedAt, desc: false, page: 1, size: 10 },
  depth: number = 1
): Promise<BaseResponse<Comment[]>> {
  const res = await axiosClient.get<BaseResponse<Comment[]>>(`/comment/list`, {
    params: {
      targetType,
      targetId,
      ...pagination,
      depth
    }
  })
  return res.data
}