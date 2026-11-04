export interface User {
  id: number
  username: string
  nickname?: string
  avatarUrl?: string
  backgroundUrl?: string
  preferredColor?: string
  email?: string // 仅 /user/me 与管理员接口返回，公开接口不包含
  gravatarHash?: string // 邮箱的 SHA-256 哈希，用于生成 Gravatar 头像
  gender?: string
  role: Role
  language?: string
  showIpLocation: boolean
  showLikes?: boolean // 是否公开点赞记录
  showLocalTime?: boolean // 是否在主页公开当地时间
  timeZone?: string // IANA 时区，只在公开当地时间时返回
  createdAt?: string // 注册时间，仅 /user/me 与管理员接口返回
  disabled?: boolean // 是否被禁用，仅 /user/me 与管理员接口返回
  isAi?: boolean // 是否为 AI 用户，仅本人与管理员可见；前台不做区分
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
