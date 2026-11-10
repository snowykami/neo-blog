import type { BaseResponse } from '@/models/resp'
import type { User } from '@/models/user'
import { cache } from 'react'
import getAuthHeaders from '@/utils/server/auth-headers'
import axiosClient from './client'

// 仅供路由处理器（api/fe-metrics、api/get-link-info）在服务端识别当前用户；页面渲染不要用（外壳对所有人一致，登录状态在浏览器里取）。
// 没有登录凭据时直接判定为访客，不请求后端
export const getLoginUserServer = cache(async (): Promise<BaseResponse<User>> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders.Cookie)
    throw new Error('anonymous')
  const res = await axiosClient.get('/user/me', {
    headers: authHeaders,
  })
  return res.data
})
