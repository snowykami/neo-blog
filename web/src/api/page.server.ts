import type { PageModel } from '@/models/page'
import type { BaseResponse } from '@/models/resp'
import getAuthHeaders from '@/utils/server/auth-headers'
import axiosClient from './client'

/**
 * 前台服务端读取页面用 api/page.ts 的 getPageById：不带登录身份，只拿到公开页面（私密页面 404），可放进 'use cache'。
 * 这里是后台服务端读取页面（预览）：带当前用户身份，含私密页面与草稿，仅作者本人与管理员；前台页面不要用
 */
export async function getPageForEditServer({ id }: { id: string }): Promise<BaseResponse<PageModel>> {
  const res = await axiosClient.get(`/page/p/${id}/draft`, {
    headers: await getAuthHeaders(),
  })
  return res.data
}
