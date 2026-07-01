export interface OidcConfig {
  id: number
  name: string
  displayName: string
  icon: string
  loginUrl: string
  // for admin
  oidcDiscoveryUrl?: string
  clientId?: string
  clientSecret?: string
  tokenAuthMethod?: 'client_secret_post' | 'client_secret_basic'
  issuer?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  userinfoEndpoint?: string
  jwksUri?: string
  type?: string
  enabled?: boolean
}
