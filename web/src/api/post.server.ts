import type { Post } from '@/models/post'
import type { BaseResponse } from '@/models/resp'
import getAuthHeaders from '@/utils/server/auth-headers'
import axiosClient from './client'

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
