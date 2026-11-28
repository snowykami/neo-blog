import type { APITokenScope } from '@/models/api-token'

export interface OAuthAuthorizeQuery {
  clientId: string
  redirectUri: string
  responseType: string
  scope?: string
  state?: string
  codeChallenge: string
  codeChallengeMethod: string
  resource?: string
}

export interface OAuthAuthorizeInfo {
  clientId: string
  clientName: string
  clientUri: string
  logoUri: string
  redirectUri: string
  callbackTarget: string
  requestedScopes: APITokenScope[]
  grantedScopes: APITokenScope[]
  unavailableScopes: APITokenScope[]
}

export interface OAuthAuthorizeDecisionReq extends OAuthAuthorizeQuery {
  approve: boolean
  scopes?: APITokenScope[]
}

export interface OAuthAuthorizeDecisionResp {
  redirectUrl: string
}
