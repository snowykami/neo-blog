import type { Post } from '@/models/post'
import type { BaseResponse } from '@/models/resp'
import getAuthHeaders from '@/utils/server/auth-headers'
import axiosClient from './client'

/**
 * 前台服务端读取文章：不带登录身份，只拿到公开文章的已发布内容，所有人看到的一样（私密文章 404）。
 * 列表直接用 api/post.ts 的 listPosts，同样不带登录身份
 */
export async function getPostByIdServer({ id }: { id: string }): Promise<BaseResponse<Post | null>> {
  const res = await axiosClient.get(`/post/p/${id}`)
  return res.data
}

// 后台服务端读取文章（编辑页标题、预览）：带当前用户身份，含私密文章与草稿，仅作者本人与管理员；前台页面不要用
export async function getPostForEditServer({ id }: { id: string }): Promise<BaseResponse<Post>> {
  const res = await axiosClient.get(`/post/p/${id}/draft`, {
    headers: await getAuthHeaders(),
  })
  return res.data
}
