import type { BaseResponse } from '@/models/resp'
import type { User } from '@/models/user'
import getAuthHeaders from '@/utils/server/auth-headers'
import axiosClient from './client'

export async function getLoginUserServer(): Promise<BaseResponse<User>> {
  const authHeaders = await getAuthHeaders()
  const res = await axiosClient.get<BaseResponse<User>>('/user/me', {
    headers: authHeaders,
  })
  return res.data
}
