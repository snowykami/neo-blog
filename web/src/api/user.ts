import type { OidcConfig } from '@/models/oidc-config'
import type { BaseResponse } from '@/models/resp'
import type { OpenIdDto, User } from '@/models/user'
import type { CaptchaProvider } from '@/types/captcha'
import axiosClient from './client'

export async function userLogin({
  username,
  password,
  rememberMe = false,
  captcha,
}: {
  username: string
  password: string
  rememberMe?: boolean
  captcha?: string
}): Promise<BaseResponse<{ token: string, user: User }>> {
  const res = await axiosClient.post<BaseResponse<{ token: string, user: User }>>(
    '/user/login',
    { username, password, rememberMe },
    { headers: { 'X-Captcha-Token': captcha || '' } },
  )
  return res.data
}

export async function userLogout(): Promise<BaseResponse<null>> {
  const res = await axiosClient.post<BaseResponse<null>>('/user/logout')
  return res.data
}

export async function userRegister({
  username,
  password,
  email,
  verifyCode,
  captchaToken,
}: {
  username: string
  password: string
  email: string
  verifyCode?: string
  captchaToken?: string
}): Promise<BaseResponse<{ token: string, user: User }>> {
  const res = await axiosClient.post<BaseResponse<{ token: string, user: User }>>(
    '/user/register',
    { username, password },
    {
      headers: {
        'X-Email': email,
        'X-VerifyCode': verifyCode || '',
        'X-Captcha-Token': captchaToken || '',
      },
    },
  )
  return res.data
}

export async function listOidcConfigs(): Promise<BaseResponse<OidcConfig[]>> {
  const res = await axiosClient.get<BaseResponse<OidcConfig[]>>('/user/oidc/list')
  return res.data
}

export async function getLoginUser(): Promise<BaseResponse<User>> {
  const res = await axiosClient.get<BaseResponse<User>>('/user/me')
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

export async function getCaptchaConfig(): Promise<
  BaseResponse<{
    provider: CaptchaProvider
    siteKey: string
    url?: string
  }>
> {
  const res = await axiosClient.get<
    BaseResponse<{
      provider: CaptchaProvider
      siteKey: string
      url?: string
    }>
  >('/user/captcha')
  return res.data
}

export async function updateUser(data: Partial<User>): Promise<BaseResponse<User>> {
  const res = await axiosClient.put<BaseResponse<User>>(`/user/u/${data.id}`, data)
  return res.data
}

export async function requestEmailVerifyCode({
  email,
  captchaToken,
}: {
  email: string
  captchaToken?: string
}): Promise<BaseResponse<{ coolDown: number }>> {
  const res = await axiosClient.post<BaseResponse<{ coolDown: number }>>(
    '/user/email/verify',
    { email },
    { headers: { 'X-Captcha-Token': captchaToken } },
  )
  return res.data
}

export async function updatePassword({
  oldPassword,
  newPassword,
}: {
  oldPassword: string
  newPassword: string
}): Promise<BaseResponse<null>> {
  const res = await axiosClient.put<BaseResponse<null>>('/user/password/edit', {
    oldPassword,
    newPassword,
  })
  return res.data
}

export async function resetPassword({
  email,
  newPassword,
  verifyCode,
}: {
  email: string
  newPassword: string
  verifyCode: string
}): Promise<BaseResponse<null>> {
  const res = await axiosClient.put<BaseResponse<null>>(
    '/user/password/reset',
    { newPassword },
    { headers: { 'X-Email': email, 'X-VerifyCode': verifyCode } },
  )
  return res.data
}

export async function updateEmail({
  newEmail,
  verifyCode,
}: {
  newEmail: string
  verifyCode: string
}): Promise<BaseResponse<null>> {
  const res = await axiosClient.put<BaseResponse<null>>('/user/email/edit', null, {
    headers: { 'X-Email': newEmail, 'X-VerifyCode': verifyCode },
  })
  return res.data
}

export async function getUserOpenIdList(): Promise<BaseResponse<{ openids: OpenIdDto[] }>> {
  const res = await axiosClient.get<BaseResponse<{ openids: OpenIdDto[] }>>('/user/openids')
  return res.data
}

export async function unbindUserOpenId(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete<BaseResponse<null>>(`/user/openid/${id}`)
  return res.data
}
