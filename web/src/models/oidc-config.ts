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
  enabled?: boolean
}
