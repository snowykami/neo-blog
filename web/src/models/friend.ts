import type { UserBrief } from './user'

export const FRIEND_GROUP_PRESETS = ['friends', 'seniors', 'official', 'projects', 'tech', 'others', 'custom'] as const
export type FriendGroupPresetKey = (typeof FRIEND_GROUP_PRESETS)[number]

export const FRIEND_STATUSES = ['pending', 'pre_approved', 'approved', 'rejected'] as const
export type FriendStatus = (typeof FRIEND_STATUSES)[number]

export type FriendHealthStatus = 'unknown' | 'healthy' | 'slow' | 'unreachable'
export type FriendBacklinkStatus = 'unchecked' | 'verified' | 'missing' | 'skipped'

export interface FriendPaletteEntry {
  key: FriendColorKey
  hex: string
  h: number
  c: number
}

/**
 * 友链 32 色全色域预设色板（与后端 model.FriendColorKeys 及 LYRIC_COLORS 一一对应）：
 * 通过 CSS 变量 --fl-h / --fl-c 驱动 .friend-card-adaptive 清透双态渲染
 */
export const FRIEND_PALETTE_32 = [
  { key: 'crimson', hex: '#ff5c6c', h: 16, c: 0.19 },
  { key: 'rose', hex: '#ff6f91', h: 4, c: 0.18 },
  { key: 'cherry-blossom', hex: '#ffb3c8', h: 352, c: 0.14 },
  { key: 'bauhinia', hex: '#e86fb0', h: 336, c: 0.17 },
  { key: 'peach', hex: '#ffa8a0', h: 24, c: 0.14 },
  { key: 'flame', hex: '#ff6a3d', h: 34, c: 0.19 },
  { key: 'maple', hex: '#ff7f3f', h: 44, c: 0.18 },
  { key: 'sunset', hex: '#ff8a65', h: 36, c: 0.16 },
  { key: 'coral', hex: '#ff9f80', h: 40, c: 0.14 },
  { key: 'amber', hex: '#ffb347', h: 68, c: 0.16 },
  { key: 'gold', hex: '#f5c542', h: 84, c: 0.16 },
  { key: 'sunshine', hex: '#ffd54f', h: 90, c: 0.15 },
  { key: 'lemon', hex: '#fff176', h: 102, c: 0.14 },
  { key: 'candlelight', hex: '#ffe0a3', h: 78, c: 0.11 },
  { key: 'spring-green', hex: '#a5e887', h: 136, c: 0.15 },
  { key: 'forest', hex: '#5fd38d', h: 152, c: 0.15 },
  { key: 'mint', hex: '#8ef0c8', h: 165, c: 0.12 },
  { key: 'jade', hex: '#3fcf9e', h: 168, c: 0.14 },
  { key: 'aurora', hex: '#6effd0', h: 172, c: 0.14 },
  { key: 'lake', hex: '#4fd1d9', h: 196, c: 0.13 },
  { key: 'sky', hex: '#74c0fc', h: 235, c: 0.14 },
  { key: 'ocean', hex: '#3d9df5', h: 248, c: 0.17 },
  { key: 'starry-blue', hex: '#6c8cff', h: 266, c: 0.17 },
  { key: 'midnight', hex: '#7b83eb', h: 274, c: 0.15 },
  { key: 'ice', hex: '#b5e8ff', h: 224, c: 0.11 },
  { key: 'rain', hex: '#9bb7d4', h: 240, c: 0.06 },
  { key: 'lavender', hex: '#c3a6ff', h: 294, c: 0.15 },
  { key: 'violet', hex: '#a77bff', h: 298, c: 0.18 },
  { key: 'twilight', hex: '#b388eb', h: 306, c: 0.15 },
  { key: 'wisteria', hex: '#d4a5f5', h: 318, c: 0.14 },
  { key: 'moonlight', hex: '#dfe8ff', h: 255, c: 0.05 },
  { key: 'silver', hex: '#cfd6e3', h: 250, c: 0.03 },
] as const

export type FriendColorKey = (typeof FRIEND_PALETTE_32)[number]['key']

export function resolveFriendPalette(key?: string | null) {
  return FRIEND_PALETTE_32.find(item => item.key === key) ?? FRIEND_PALETTE_32[20]
}

export function pickFriendColorFromSeed(seed: string): FriendColorKey {
  let hash = 0
  for (let i = 0; i < seed.length; i++)
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return FRIEND_PALETTE_32[hash % FRIEND_PALETTE_32.length].key
}

export interface FriendLinkPublic {
  id: number
  groupId: number
  name: string
  url: string
  avatar: string
  description: string
  colorKey: FriendColorKey
  sortOrder: number
  healthStatus: FriendHealthStatus
  latencyMs: number
}

export interface FriendGroupPublic {
  id: number
  presetKey: FriendGroupPresetKey
  name: string
  slug: string
  description: string
  sortOrder: number
  links: FriendLinkPublic[]
}

export interface FriendSiteCard {
  name: string
  url: string
  avatar: string
  description: string
}

export interface PublicFriendsData {
  groups: FriendGroupPublic[]
  siteInfo: FriendSiteCard
}

export interface FriendLinkMine {
  id: number
  groupId: number
  name: string
  url: string
  avatar: string
  description: string
  colorKey: FriendColorKey
  backlinkUrl: string
  status: FriendStatus
  reviewNote: string
  healthStatus: FriendHealthStatus
  latencyMs: number
  createdAt: string
  updatedAt: string
}

export interface MyFriendLinksData {
  links: FriendLinkMine[]
  quotaLimit: number
  autofillRemaining: number
  autofillLimit: number
  aiReviewRemaining: number
  aiReviewLimit: number
}

export interface FriendAutofillResult {
  name: string
  url: string
  avatar: string
  description: string
  colorKey: FriendColorKey
  autofillRemaining: number
}

export interface UpsertMyFriendLinkPayload {
  groupId: number
  name: string
  url: string
  avatar: string
  description: string
  colorKey: FriendColorKey
  backlinkUrl: string
}

export interface FriendGroupAdmin {
  id: number
  presetKey: FriendGroupPresetKey
  name: string
  slug: string
  description: string
  sortOrder: number
  isPublic: boolean
  skipBacklinkCheck: boolean
  linkCount: number
  createdAt: string
  updatedAt: string
}

export interface FriendLinkAdmin {
  id: number
  userId: number
  user?: UserBrief
  groupId: number
  name: string
  url: string
  avatar: string
  description: string
  colorKey: FriendColorKey
  backlinkUrl: string
  sortOrder: number
  status: FriendStatus
  reviewNote: string
  healthStatus: FriendHealthStatus
  latencyMs: number
  failCount: number
  backlinkStatus: FriendBacklinkStatus
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminListFriendLinksData {
  links: FriendLinkAdmin[]
  total: number
  pendingReviewCount: number
}

export interface AdminUpsertFriendGroupPayload {
  presetKey: FriendGroupPresetKey
  name: string
  slug: string
  description: string
  sortOrder?: number
  isPublic: boolean
  skipBacklinkCheck: boolean
}

export interface AdminUpsertFriendLinkPayload {
  groupId: number
  name: string
  url: string
  avatar: string
  description: string
  colorKey: FriendColorKey
  backlinkUrl: string
  sortOrder: number
  status: FriendStatus
  reviewNote: string
}

export interface AdminReviewFriendLinkPayload {
  status: FriendStatus
  groupId?: number
  reviewNote: string
}
