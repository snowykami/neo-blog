import type { APIToken, APITokenScope } from '@/models/api-token'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

export async function listAPITokens(): Promise<BaseResponse<{ apiTokens: APIToken[] }>> {
  const res = await axiosClient.get<BaseResponse<{ apiTokens: APIToken[] }>>('/user/api-tokens')
  return res.data
}

// 创建 Token，明文只在本次响应中返回
export async function createAPIToken(data: {
  name: string
  scopes: APITokenScope[]
  expiresAt: string | null
}): Promise<BaseResponse<{ apiToken: APIToken, token: string }>> {
  const res = await axiosClient.post<BaseResponse<{ apiToken: APIToken, token: string }>>('/user/api-tokens', data)
  return res.data
}

export async function revokeAPIToken({ id }: { id: number }): Promise<BaseResponse<null>> {
  const res = await axiosClient.post<BaseResponse<null>>(`/user/api-tokens/${id}/revoke`)
  return res.data
}
