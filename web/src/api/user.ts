import type { OidcConfig } from '@/models/oidc-config'
import type { BaseResponse } from '@/models/resp'
import type {  RegisterRequest, User } from '@/models/user'
import axiosClient from './client'
import { CaptchaProvider } from '@/models/captcha'

export async function userLogin(
  {
    username,
    password,
    rememberMe,
    captcha
  }: {
    username: string,
    password: string,
    rememberMe?: boolean,
    captcha?: string,
  }): Promise<BaseResponse<{ token: string, user: User }>> {
  console.log("Logging in with captcha:", captcha)
  const res = await axiosClient.post<BaseResponse<{ token: string, user: User }>>(
    '/user/login',
    { username, password, rememberMe },
    { headers: { 'X-Captcha-Token': captcha || '' } },
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

export async function getUserByUsername(username: string): Promise<BaseResponse<User>> {
  const res = await axiosClient.get<BaseResponse<User>>(`/user/username/${username}`)
  return res.data
}

export async function getCaptchaConfig(): Promise<BaseResponse<{
  provider: CaptchaProvider
  siteKey: string
  url?: string
}>> {
  const res = await axiosClient.get<BaseResponse<{
    provider: CaptchaProvider
    siteKey: string
    url?: string
  }>>('/user/captcha')
  return res.data
}