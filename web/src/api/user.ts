import type { OidcConfig } from '@/models/oidc-config'
import type { BaseResponse } from '@/models/resp'
import type { LoginRequest, RegisterRequest, User } from '@/models/user'
import axiosClient from './client'

export async function userLogin(
  data: LoginRequest,
): Promise<BaseResponse<{ token: string, user: User }>> {
  const res = await axiosClient.post<BaseResponse<{ token: string, user: User }>>(
    '/user/login',
    data,
  )
  return res.data
}

export async function userRegister(
  data: RegisterRequest,
): Promise<BaseResponse<{ token: string, user: User }>> {
  const res = await axiosClient.post<BaseResponse<{ token: string, user: User }>>(
    '/user/register',
    data,
  )
  return res.data
}

export async function ListOidcConfigs(): Promise<BaseResponse<OidcConfig[]>> {
  const res = await axiosClient.get<BaseResponse<OidcConfig[]>>(
    '/user/oidc/list',
  )
  return res.data
}

export async function getLoginUser(token: string = ''): Promise<BaseResponse<User>> {
  const res = await axiosClient.get<BaseResponse<User>>('/user/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  return res.data
}

export async function getUserById(id: number): Promise<BaseResponse<User>> {
  const res = await axiosClient.get<BaseResponse<User>>(`/user/u/${id}`)
  return res.data
}
