import axiosClient from './client'
import { Comment } from '@/models/comment'
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
    isPrivate = false,
    showClientInfo = true,
  }: {
    targetType: TargetType
    targetId: number
    content: string
    replyId: number | null
    isPrivate: boolean
    showClientInfo: boolean
  }
): Promise<BaseResponse<{ id: number }>> {
  const res = await axiosClient.post<BaseResponse<{ id: number }>>('/comment/c', {
    targetType,
    targetId,
    content,
    replyId,
    isPrivate,
    showClientInfo,
  })
  return res.data
}

export async function updateComment(
  {
    id, content,
    isPrivate = false
  }: {
    id: number
    content: string
    isPrivate?: boolean // 可选字段，默认为 false
  }
): Promise<BaseResponse<Comment>> {
  const res = await axiosClient.put<BaseResponse<Comment>>(`/comment/c/${id}`, {
    content,
    isPrivate
  })
  return res.data
}

export async function deleteComment({ id }: { id: number }): Promise<void> {
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
  const res = await axiosClient.get<BaseResponse<{ "comments": Comment[] }>>(`/comment/list`, {
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

export async function getComment({ id }: { id: number }): Promise<BaseResponse<Comment>> {
  const res = await axiosClient.get<BaseResponse<Comment>>(`/comment/c/${id}`)
  return res.data
}