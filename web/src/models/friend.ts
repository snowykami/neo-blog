import type { UserBrief } from './user'

export const FRIEND_GROUP_PRESETS = ['friends', 'seniors', 'official', 'projects', 'tech', 'others', 'custom'] as const
export type FriendGroupPresetKey = (typeof FRIEND_GROUP_PRESETS)[number]

export const FRIEND_STATUSES = ['pending', 'pre_approved', 'approved', 'rejected'] as const
export type FriendStatus = (typeof FRIEND_STATUSES)[number]

export const FRIEND_SORT_MODES = ['manual', 'activity'] as const
export type FriendSortMode = (typeof FRIEND_SORT_MODES)[number]

export type FriendHealthStatus = 'unknown' | 'healthy' | 'slow' | 'unreachable'
export type FriendBacklinkStatus = 'unchecked' | 'verified' | 'missing' | 'skipped'

export const FRIEND_TECH_CATEGORIES = ['cdn', 'server', 'cms', 'framework'] as const
export type FriendTechCategory = (typeof FRIEND_TECH_CATEGORIES)[number]

export interface FriendTechItem {
  id: string
  name: string
  category: FriendTechCategory
}

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

/**
 * 表单实时预览门控：仅当输入已是完整 http(s) 域名地址或合法的站内文件相对路径时才渲染预览头像，
 * 避免敲击键盘过程中对半截字符串连续发起无效图片请求
 */
export function isPreviewableAvatarUrl(raw?: string | null): boolean {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed)
    return false
  if (trimmed.startsWith('/')) {
    return /^(?:\/api\/v1\/file\/f\/\d+(?:\/[^\s\\?#]*)?|\/api\/site-icon)(?:[?#][^\s\\]*)?$/.test(trimmed)
      && !trimmed.includes('..')
  }
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed))
    return false
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return false
    return parsed.hostname === 'localhost' || parsed.hostname.includes('.') || parsed.hostname.includes(':')
  }
  catch {
    return false
  }
}

export interface FriendLinkPublic {
  id: number
  groupId: number
  name: string
  url: string
  avatar: string
  avatarUrl?: string
  description: string
  colorKey: FriendColorKey
  rssUrl?: string
  sortOrder: number
  healthStatus: FriendHealthStatus
  latencyMs: number
  techStack?: FriendTechItem[]
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
  sortMode?: FriendSortMode
  groups: FriendGroupPublic[]
  siteInfo: FriendSiteCard
}

export interface FriendLinkMine {
  id: number
  groupId: number
  name: string
  url: string
  avatar: string
  avatarUrl?: string
  description: string
  colorKey: FriendColorKey
  rssUrl: string
  backlinkUrl: string
  status: FriendStatus
  reviewNote: string
  healthStatus: FriendHealthStatus
  latencyMs: number
  techStack?: FriendTechItem[]
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
  rssUrl?: string
  backlinkUrl?: string
  autofillRemaining: number
}

export interface UpsertMyFriendLinkPayload {
  groupId: number
  name: string
  url: string
  avatar: string
  description: string
  colorKey: FriendColorKey
  rssUrl: string
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
  avatarUrl?: string
  description: string
  colorKey: FriendColorKey
  rssUrl: string
  backlinkUrl: string
  sortOrder: number
  status: FriendStatus
  reviewNote: string
  healthStatus: FriendHealthStatus
  latencyMs: number
  failCount: number
  backlinkStatus: FriendBacklinkStatus
  techStack?: FriendTechItem[]
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
  rssUrl: string
  backlinkUrl: string
  sortOrder?: number
  status: FriendStatus
  reviewNote: string
}

export interface FriendGroupSortItem {
  group: FriendGroupAdmin
  links: FriendLinkAdmin[]
}

export interface AdminFriendSortOverview {
  sortMode: FriendSortMode
  groups: FriendGroupSortItem[]
}

export interface AdminReviewFriendLinkPayload {
  status: FriendStatus
  groupId?: number
  reviewNote: string
}

export interface FriendAdminSettings {
  backlinkAliasHosts: string[]
}

export interface AdminUpdateFriendSettingsPayload {
  backlinkAliasHosts: string[]
}

function leadingAliasSchemeEnd(value: string): number {
  const match = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value)
  return match ? match[0].length : -1
}

function splitSingleAliasChunk(chunk: string): string[] {
  let trimmed = chunk.replace(/^[,，;；\s]+|[,，;；\s]+$/g, '')
  if (!trimmed)
    return []

  const multiUrlMatch = /[,，;；](?=https?:\/\/)/i.exec(trimmed)
  if (multiUrlMatch && multiUrlMatch.index > 0) {
    const left = trimmed.slice(0, multiUrlMatch.index)
    const right = trimmed.slice(multiUrlMatch.index + 1)
    return [...splitSingleAliasChunk(left), ...splitSingleAliasChunk(right)]
  }

  const schemeEnd = leadingAliasSchemeEnd(trimmed)
  if (schemeEnd > 0) {
    const rest = trimmed.slice(schemeEnd)
    const firstPath = rest.search(/[/?#]/)
    const firstDelim = rest.search(/[,，;；]/)
    if (firstDelim >= 0 && (firstPath < 0 || firstDelim < firstPath)) {
      const left = trimmed.slice(0, schemeEnd + firstDelim)
      const right = rest.slice(firstDelim + 1)
      return [...splitSingleAliasChunk(left), ...splitSingleAliasChunk(right)]
    }
    if (firstPath >= 0)
      trimmed = trimmed.slice(0, schemeEnd + firstPath)
    trimmed = trimmed.replace(/^[,，;；]+|[,，;；]+$/g, '')
    return trimmed ? [trimmed] : []
  }

  const firstDelim = trimmed.search(/[,，;；]/)
  const firstPath = trimmed.search(/[/?#]/)
  if (firstDelim >= 0 && (firstPath < 0 || firstDelim < firstPath)) {
    const left = trimmed.slice(0, firstDelim)
    const right = trimmed.slice(firstDelim + 1)
    return [...splitSingleAliasChunk(left), ...splitSingleAliasChunk(right)]
  }
  if (firstPath > 0)
    trimmed = trimmed.slice(0, firstPath).replace(/^[,，;；]+|[,，;；]+$/g, '')
  return trimmed ? [trimmed] : []
}

export function splitFriendBacklinkAliasesInput(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed)
    return []
  return trimmed
    .split(/\s+/)
    .flatMap(chunk => splitSingleAliasChunk(chunk))
}

const MULTI_TENANT_HOST_SUFFIXES = [
  'github.io',
  'gitlab.io',
  'vercel.app',
  'pages.dev',
  'netlify.app',
  'cloudflarepages.com',
  'zeabur.app',
  'fly.dev',
  'web.app',
  'firebaseapp.com',
  'onrender.com',
  'railway.app',
] as const

const TWO_PART_PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'co.jp',
  'ne.jp',
  'or.jp',
  'co.kr',
  'or.kr',
  'com.hk',
  'com.tw',
  'org.tw',
  'idv.tw',
  'com.au',
  'org.au',
])

export function normalizeFriendUrlHost(raw?: string | null): string {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed)
    return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(withScheme)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return ''
    return parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  }
  catch {
    return ''
  }
}

function getRegistrableHostTail(host: string): string {
  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2)
    return host
  const tail2 = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`
  if (TWO_PART_PUBLIC_SUFFIXES.has(tail2) && parts.length >= 3)
    return `${parts[parts.length - 3]}.${tail2}`
  return tail2
}

export function isRelatedFriendUrlHost(
  candidateUrl?: string | null,
  siteUrl?: string | null,
  opts?: { allowExternalFeedHosts?: boolean },
): boolean {
  const candHost = normalizeFriendUrlHost(candidateUrl)
  const siteHost = normalizeFriendUrlHost(siteUrl)
  if (!candHost || !siteHost)
    return false
  if (candHost === siteHost || candHost.endsWith(`.${siteHost}`) || siteHost.endsWith(`.${candHost}`))
    return true
  if (opts?.allowExternalFeedHosts) {
    if (
      candHost === 'feedburner.com'
      || candHost.endsWith('.feedburner.com')
      || candHost === 'rsshub.app'
      || candHost.endsWith('.rsshub.app')
      || candHost === 'follow.is'
      || candHost.endsWith('.follow.is')
    ) {
      return true
    }
  }
  const isMultiTenant = MULTI_TENANT_HOST_SUFFIXES.some(
    suffix =>
      candHost === suffix
      || candHost.endsWith(`.${suffix}`)
      || siteHost === suffix
      || siteHost.endsWith(`.${suffix}`),
  )
  if (isMultiTenant)
    return false
  return getRegistrableHostTail(candHost) === getRegistrableHostTail(siteHost)
}

export interface FriendAutoMetaSnapshot {
  source: 'none' | 'seed' | 'autofill' | 'paste'
  siteHost: string
  description: string
  rssUrl: string
  backlinkUrl: string
}

export const EMPTY_FRIEND_AUTO_META: FriendAutoMetaSnapshot = {
  source: 'none',
  siteHost: '',
  description: '',
  rssUrl: '',
  backlinkUrl: '',
}

export function resolveAutofillOptionalFields(params: {
  targetUrl: string
  current: {
    description: string
    rssUrl: string
    backlinkUrl: string
  }
  incoming: {
    description?: string
    rssUrl?: string
    backlinkUrl?: string
  }
  prevMeta: FriendAutoMetaSnapshot
}): {
  updates: Partial<Record<'description' | 'rssUrl' | 'backlinkUrl', string>>
  nextMeta: FriendAutoMetaSnapshot
} {
  const { targetUrl, current, incoming, prevMeta } = params
  const nextHost = normalizeFriendUrlHost(targetUrl)
  const hostChanged = Boolean(prevMeta.siteHost && nextHost && prevMeta.siteHost !== nextHost)
  const updates: Partial<Record<'description' | 'rssUrl' | 'backlinkUrl', string>> = {}

  const inDesc = incoming.description?.trim() ?? ''
  const curDesc = current.description.trim()
  if (inDesc) {
    updates.description = incoming.description!
  }
  else if (hostChanged || (prevMeta.source === 'autofill' && curDesc === prevMeta.description && curDesc !== '')) {
    updates.description = ''
  }

  const inRss = incoming.rssUrl?.trim() ?? ''
  const curRss = current.rssUrl.trim()
  const curRssCrossSite = Boolean(
    curRss && nextHost && !isRelatedFriendUrlHost(curRss, targetUrl, { allowExternalFeedHosts: !hostChanged }),
  )
  if (inRss) {
    if (!curRss || hostChanged || curRssCrossSite || curRss === prevMeta.rssUrl)
      updates.rssUrl = inRss
  }
  else if (hostChanged || curRssCrossSite || (prevMeta.source === 'autofill' && curRss === prevMeta.rssUrl && curRss !== '')) {
    updates.rssUrl = ''
  }

  const inBacklink = incoming.backlinkUrl?.trim() ?? ''
  const curBacklink = current.backlinkUrl.trim()
  const curBacklinkCrossSite = Boolean(
    curBacklink && nextHost && !isRelatedFriendUrlHost(curBacklink, targetUrl),
  )
  if (inBacklink) {
    if (!curBacklink || hostChanged || curBacklinkCrossSite || curBacklink === prevMeta.backlinkUrl)
      updates.backlinkUrl = inBacklink
  }
  else if (hostChanged || curBacklinkCrossSite || (prevMeta.source === 'autofill' && curBacklink === prevMeta.backlinkUrl && curBacklink !== '')) {
    updates.backlinkUrl = ''
  }

  const nextMeta: FriendAutoMetaSnapshot = {
    source: 'autofill',
    siteHost: nextHost,
    description: (updates.description ?? current.description).trim(),
    rssUrl: (updates.rssUrl ?? current.rssUrl).trim(),
    backlinkUrl: (updates.backlinkUrl ?? current.backlinkUrl).trim(),
  }

  return { updates, nextMeta }
}

export type ParsedFriendSnippet = Partial<
  Record<'name' | 'url' | 'avatar' | 'description' | 'rssUrl' | 'backlinkUrl', string>
>

/**
 * 解析主流开源博客（Hexo / Hugo / Astro / JSON / YAML / 键值文本）友链片段：
 * 严格按互斥分类分支匹配键名，避免多条订阅或回链字段因 `!out.xxx` 条件穿透污染 `url` / `name`
 */
export function parseFriendTextSnippet(raw: string): ParsedFriendSnippet {
  const trimmed = raw.trim()
  if (!trimmed)
    return {}

  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      const pick = (...keys: string[]) => {
        for (const k of keys) {
          if (typeof obj[k] === 'string' && (obj[k] as string).trim())
            return (obj[k] as string).trim()
        }
        return undefined
      }
      return {
        name: pick('name', 'title', 'site', 'sitename', 'site_name', 'siteName'),
        url: pick('url', 'link', 'href', 'site_url', 'siteUrl'),
        avatar: pick('avatar', 'icon', 'logo', 'img', 'image', 'avatar_url', 'avatarUrl'),
        description: pick('description', 'desc', 'descr', 'bio', 'slogan'),
        rssUrl: pick('rss', 'feed', 'atom', 'rss_url', 'rssUrl', 'feed_url', 'feedUrl'),
        backlinkUrl: pick('backlink', 'backlink_url', 'backlinkUrl'),
      }
    }
    catch {
      // 回退逐行解析
    }
  }

  const out: ParsedFriendSnippet = {}
  const lines = trimmed.split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.replace(/^[-*•\s]+/, '').trim()
    const sepIdx = line.search(/[:：=]/)
    if (sepIdx <= 0)
      continue
    const key = line.slice(0, sepIdx).trim().toLowerCase()
    const val = line.slice(sepIdx + 1).trim().replace(/^['"`]+|['"`,]+$/g, '')
    if (!val)
      continue

    if (/rss|atom|feed|订阅|訂閱|フィード|피드/.test(key)) {
      if (!out.rssUrl)
        out.rssUrl = val
    }
    else if (/backlink|回链|回鏈|反链|反鏈|相互リンク|맞링크/.test(key)) {
      if (!out.backlinkUrl)
        out.backlinkUrl = val
    }
    else if (/avatar|icon|logo|img|image|头像|頭像|图标|圖示|アイコン|아이콘/.test(key)) {
      if (!out.avatar)
        out.avatar = val
    }
    else if (/desc|bio|slogan|motto|描述|简介|簡介|签名|簽名|介绍|介紹|紹介|소개/.test(key)) {
      if (!out.description)
        out.description = val
    }
    else if (/url|link|href|地址|網址|链接|連結|网址|リンク|주소/.test(key)) {
      if (!out.url)
        out.url = val
    }
    else if (/name|title|sitename|名称|名稱|名字|站名|网站名|網站名|标题|標題|サイト名|사이트\s*이름|^site$|^站点$|^站點$/.test(key)) {
      if (!out.name)
        out.name = val
    }
  }
  return out
}
