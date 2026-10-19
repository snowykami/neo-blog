import type { Post } from '@/models/post'
import type { BaseResponse } from '@/models/resp'
import getAuthHeaders from '@/utils/server/auth-headers'
import axiosClient from './client'
import { listPosts } from './post'

export async function getPostByIdServer({
  id,
  type = 'normal',
}: {
  id: string
  type?: 'draft' | 'normal'
}): Promise<BaseResponse<Post | null>> {
  const authHeaders = await getAuthHeaders()
  const res = await axiosClient.get(`/post/p/${id}`, {
    params: { type },
    headers: authHeaders,
  })
  return res.data
}

// 服务端获取文章列表，携带当前用户身份（登录用户可看到自己的私密文章）
export async function listPostsServer(params: Parameters<typeof listPosts>[0]) {
  return listPosts(params, { headers: await getAuthHeaders() })
}
