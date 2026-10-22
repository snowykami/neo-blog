export interface User {
  id: number
  username: string
  nickname?: string
  avatarUrl?: string
  backgroundUrl?: string
  preferredColor?: string
  email?: string // 仅 /user/me 与管理员接口返回，公开接口不包含
  gender?: string
  role: Role
  language?: string
  showIpLocation: boolean
  createdAt?: string // 注册时间，仅 /user/me 与管理员接口返回
}

export enum Role {
  ADMIN = 'admin',
  USER = 'user',
  EDITOR = 'editor',
}

export interface OpenIdDto {
  id: number
  userId: number
  issuer: string
  sub: string
  name: string
  email: string
  picture: string
  preferredUsername: string
  oidcName: string
  oidcIcon: string
  oidcDisplayName: string
}

export interface IpData {
  country: string
  province: string
  city: string
  districts: string
  isp: string
}
