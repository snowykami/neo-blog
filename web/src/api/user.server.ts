import type { BaseResponse } from '@/models/resp'
import type { User } from '@/models/user'
import { cache } from 'react'
import getAuthHeaders from '@/utils/server/auth-headers'
import axiosClient from './client'

// 同一次服务端渲染内（根布局、i18n 语言解析等）只请求一次 /user/me；没有登录凭据时直接判定为访客，不请求后端
export const getLoginUserServer = cache(async (): Promise<BaseResponse<User>> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders.Cookie)
    throw new Error('anonymous')
  const res = await axiosClient.get('/user/me', {
    headers: authHeaders,
  })
  return res.data
})
