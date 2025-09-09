import axiosClient from './client'
import { UpdateCommentRequest, Comment } from '@/models/comment'
import { PaginationParams } from '@/models/common'
import { OrderBy } from '@/models/common'
import type { BaseResponse } from '@/models/resp'
import { TargetType } from '@/models/types'


export async function createComment(
  {
    targetType,
    targetId,
    content,
    replyId = null,
    isPrivate = false
  }: {
    targetType: TargetType
    targetId: number
    content: string
    replyId: number | null
    isPrivate: boolean
  }
): Promise<BaseResponse<Comment>> {
  const res = await axiosClient.post<BaseResponse<Comment>>('/comment/c', {
    targetType,
    targetId,
    content,
    replyId,
    isPrivate
  })
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


export async function listComments({
  targetType,
  targetId,
  depth = 0,
  commentId = 0,
  orderBy = OrderBy.CreatedAt,
  desc = true,
  page = 1,
  size = 10,
}: {
  targetType: TargetType
  targetId: number
  depth: number
  commentId: number
} & PaginationParams
) {
  const res = await axiosClient.get<BaseResponse<Comment[]>>(`/comment/list`, {
    params: {
      targetType,
      targetId,
      depth,
      orderBy,
      desc,
      page,
      size,
      commentId,
    }
  })
  return res.data
}