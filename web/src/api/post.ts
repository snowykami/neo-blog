import type { Post } from '@/models/post'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'
import { OrderBy, PaginationParams } from '@/models/common'


export async function getPostById({ id, token = "" }: { id: string, token?: string }): Promise<BaseResponse<Post | null>> {
  const res = await axiosClient.get<BaseResponse<Post>>(`/post/p/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
  return res.data
}

export async function listPosts({
  page = 1,
  size = 10,
  orderBy = OrderBy.CreatedAt,
  desc = false,
  keywords = '',
  label = '',
}: {
  keywords?: string, // 关键词，逗号分割
  label?: string, // 标签，逗号分割
} & PaginationParams): Promise<BaseResponse<{ "posts": Post[], "total": number }>> {
  const res = await axiosClient.get<BaseResponse<{ "posts": Post[], "total": number }>>('/post/list', {
    params: {
      page,
      size,
      orderBy,
      desc,
      keywords,
      label,
    },
  })
  return res.data
}

export async function updatePost({ post }: { post: Post }): Promise<BaseResponse<Post>> {
  const res = await axiosClient.put<BaseResponse<Post>>(`/post/p/${post.id}`, post)
  return res.data
}

export async function deletePost({ id }: { id: number }): Promise<null> {
  const res = await axiosClient.delete(`/post/p/${id}`)
  return res.data
}