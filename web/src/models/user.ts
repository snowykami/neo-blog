export interface User {
  id: number
  username: string
  nickname?: string
  avatarUrl?: string
  backgroundUrl?: string
  preferredColor?: string
  email: string
  gender?: string
  role: Role
  language?: string
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
}
