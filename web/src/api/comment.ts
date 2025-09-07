import axiosClient from './client'
import { CreateCommentRequest, UpdateCommentRequest, Comment } from '@/models/comment'
import type {  PaginationParams } from '@/models/common'
import { OrderBy } from '@/models/common'
import type { BaseResponse } from '@/models/resp'
import { TargetType } from '@/models/types'


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

export interface ListCommentsParams {
  targetType: TargetType
  targetId: number
  depth?: number
  orderBy?: OrderBy
  desc?: boolean
  page?: number
  size?: number
}

export async function listComments(params: ListCommentsParams): Promise<BaseResponse<Comment[]>> {
  const {
    targetType,
    targetId,
    depth = 0,
    orderBy = OrderBy.CreatedAt,
    desc = true,
    page = 1,
    size = 10,
  } = params
  const res = await axiosClient.get<BaseResponse<Comment[]>>(`/comment/list`, {
    params: {
      targetType,
      targetId,
      depth,
      orderBy,
      desc,
      page,
      size
    }
  })
  return res.data
}