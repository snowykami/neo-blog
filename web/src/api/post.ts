import type { Post } from '@/models/post'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'
import type { ListPostsParams } from '@/models/post'


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
  orderBy = 'updated_at',
  desc = false,
  keywords = '',
}: ListPostsParams = {}): Promise<BaseResponse<Post[]>> {
  const res = await axiosClient.get<BaseResponse<Post[]>>('/post/list', {
    params: {
      page,
      size,
      orderBy,
      desc,
      keywords,
    },
  })
  return res.data
}
