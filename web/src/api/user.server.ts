import type { BaseResponse } from '@/models/resp'
import type { User } from '@/models/user'
import { isAxiosError } from 'axios'
import { cache } from 'react'
import getAuthHeaders from '@/utils/server/auth-headers'
import axiosClient from './client'

export interface ServerAuthSeed {
  resolved: boolean
  user: User | null
}

// 仅供路由处理器（如 api/fe-metrics）在服务端识别当前用户；页面渲染不要用（外壳对所有人一致，登录状态在浏览器里取）。
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

// 仅用于后台受保护动态布局（connection() 后）：在服务端预先解析登录态，避免水合后再发一次 /user/me
export const getConsoleAuthSeedServer = cache(async (): Promise<ServerAuthSeed> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders.Cookie)
    return { resolved: true, user: null }
  try {
    const res = await axiosClient.get<BaseResponse<User>>('/user/me', {
      headers: authHeaders,
    })
    return { resolved: true, user: res.data.data ?? null }
  }
  catch (error) {
    if (isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403))
      return { resolved: true, user: null }
    return { resolved: false, user: null }
  }
})
