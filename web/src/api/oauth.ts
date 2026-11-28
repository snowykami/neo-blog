import type { OAuthAuthorizeDecisionReq, OAuthAuthorizeDecisionResp, OAuthAuthorizeInfo, OAuthAuthorizeQuery } from '@/models/oauth'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

const OAUTH_AUTHORIZE_URI = '/oauth/authorize'

export async function getOAuthAuthorizeInfo(params: OAuthAuthorizeQuery): Promise<BaseResponse<OAuthAuthorizeInfo>> {
  const res = await axiosClient.get<BaseResponse<OAuthAuthorizeInfo>>(`${OAUTH_AUTHORIZE_URI}/info`, { params })
  return res.data
}

export async function submitOAuthAuthorizeDecision(payload: OAuthAuthorizeDecisionReq): Promise<BaseResponse<OAuthAuthorizeDecisionResp>> {
  const res = await axiosClient.post<BaseResponse<OAuthAuthorizeDecisionResp>>(OAUTH_AUTHORIZE_URI, payload)
  return res.data
}
