import type { Post } from '@/models/post'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'
import { OrderBy, PaginationParams } from '@/models/common'


export async function getPostById(id: string, token: string=""): Promise<Post | null> {
  try {
    const res = await axiosClient.get<BaseResponse<Post>>(`/post/p/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })
    return res.data.data
  }
  catch (error) {
    console.error('Error fetching post by ID:', error)
    return null
  }
}

export async function listPosts({
  page = 1,
  size = 10,
  orderBy = OrderBy.CreatedAt,
  desc = false,
  keywords = '',
  labels = '',
  labelRule = 'union',
}: {
  keywords?: string, // 关键词，逗号分割
  labels?: string, // 标签，逗号分割
  labelRule?: 'union' | 'intersection' // 标签规则，默认并集
} & PaginationParams): Promise<BaseResponse<{"posts": Post[], "total" : number}>> {
  const res = await axiosClient.get<BaseResponse<{"posts": Post[], "total": number}>>('/post/list', {
    params: {
      page,
      size,
      orderBy,
      desc,
      keywords,
      labels,
      labelRule
    },
  })
  return res.data
}
