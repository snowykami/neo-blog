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
  issuer?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  userinfoEndpoint?: string
  jwksUri?: string
  type?: string
  enabled?: boolean
}
