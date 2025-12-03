import type { OidcConfig } from '@/models/oidc-config'
import type { BaseResponse } from '@/models/resp'
import type { IpData, OpenIdDto, User } from '@/models/user'
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
  const res = await axiosClient.post(
    '/user/login',
    { username, password, rememberMe },
    { headers: { 'X-Captcha-Token': captcha || '' } },
  )
  return res.data
}

export async function userLogout(): Promise<BaseResponse<null>> {
  const res = await axiosClient.post('/user/logout')
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
  const res = await axiosClient.post(
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
  const res = await axiosClient.get('/user/oidc/list')
  return res.data
}

export async function getLoginUser(): Promise<BaseResponse<User>> {
  const res = await axiosClient.get('/user/me')
  return res.data
}

export async function getUserById(id: number): Promise<BaseResponse<User>> {
  const res = await axiosClient.get(`/user/u/${id}`)
  return res.data
}

export async function getUserByUsername(username: string): Promise<BaseResponse<User>> {
  const res = await axiosClient.get(`/user/username/${username}`)
  return res.data
}

export async function getCaptchaConfig(): Promise<
  BaseResponse<{
    provider: CaptchaProvider
    siteKey: string
    url?: string
  }>
> {
  const res = await axiosClient.get('/user/captcha')
  return res.data
}

export async function updateUser(data: Partial<User>): Promise<BaseResponse<User>> {
  const res = await axiosClient.put(`/user/u/${data.id}`, data)
  return res.data
}

export async function requestEmailVerifyCode({
  email,
  captchaToken,
}: {
  email: string
  captchaToken?: string
}): Promise<BaseResponse<{ coolDown: number }>> {
  const res = await axiosClient.post(
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
  const res = await axiosClient.put('/user/password/edit', {
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
  const res = await axiosClient.put(
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
  const res = await axiosClient.put('/user/email/edit', null, {
    headers: { 'X-Email': newEmail, 'X-VerifyCode': verifyCode },
  })
  return res.data
}

export async function getUserOpenIdList(): Promise<BaseResponse<{ openids: OpenIdDto[] }>> {
  const res = await axiosClient.get('/user/openids')
  return res.data
}

export async function unbindUserOpenId(id: number): Promise<BaseResponse<null>> {
  const res = await axiosClient.delete(`/user/openid/${id}`)
  return res.data
}

export async function getUserIpLocation(id: number): Promise<BaseResponse<IpData>> {
  const res = await axiosClient.get(`/user/ip-location/${id}`)
  return res.data
}
