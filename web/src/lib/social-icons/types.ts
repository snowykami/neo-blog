export type SvgChildTag = 'path' | 'circle' | 'rect' | 'polygon' | 'polyline' | 'line' | 'ellipse' | 'g'

export interface IconChildNode {
  tag: SvgChildTag
  attr: Record<string, string>
  child?: IconChildNode[]
}

export interface ResolvedIconSpec {
  viewBox: string
  /** 为 true 时使用线条模式（fill="none" stroke="currentColor"），否则默认填充 currentColor */
  stroke?: boolean
  nodes: IconChildNode[]
}

export const BRAND_ICON_PREFIX = 'brand:'
export const DEFAULT_OWNER_LINK_ICON = 'globe'
export const OWNER_LINKS_MAX = 24
export const OWNER_LINK_NAME_MAX = 64
export const OWNER_LINK_URL_MAX = 1024

const OWNER_ICON_NAME_RE = /^(?:brand:)?[a-z0-9]+(?:-[a-z0-9]+)*$/

const ALLOWED_SCHEMES = new Set([
  'http',
  'https',
  'mailto',
  'tel',
  'sms',
  'tg',
  'tencent',
  'mqqapi',
  'mqqwpa',
  'weixin',
  'steam',
  'discord',
  'matrix',
  'xmpp',
  'nostr',
  'irc',
  'ircs',
  'magnet',
])

export function isOwnerLinkIconName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 80 && OWNER_ICON_NAME_RE.test(value)
}

function hasSpaceOrControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x20 || code === 0x7F || /\s/.test(value[i]))
      return true
  }
  return false
}

/**
 * 与后端 internal/config/owner_links.go 保持一致的安全链接校验：
 * 允许 http(s)、站内 / 相对路径（非 //），以及常见邮箱、电话、社交客户端唤起协议，拒绝 javascript:/data: 等危险协议
 */
export function isSafeOwnerLinkUrl(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > OWNER_LINK_URL_MAX || hasSpaceOrControl(trimmed))
    return false
  if (trimmed.startsWith('/'))
    return !trimmed.startsWith('//')
  const colon = trimmed.indexOf(':')
  if (colon <= 0)
    return false
  const scheme = trimmed.slice(0, colon).toLowerCase()
  if (!ALLOWED_SCHEMES.has(scheme))
    return false
  if (scheme === 'http' || scheme === 'https') {
    try {
      const parsed = new URL(trimmed)
      return Boolean(parsed.hostname)
    }
    catch {
      return false
    }
  }
  return trimmed.slice(colon + 1).replace(/^\/+/, '').length > 0
}

/** 根据图标键生成简短兜底名称（当未配置自定义名称且无预解析标签时用于无障碍描述） */
export function fallbackLabelFromIconName(icon: string): string {
  const bare = icon.startsWith(BRAND_ICON_PREFIX) ? icon.slice(BRAND_ICON_PREFIX.length) : icon
  if (bare === 'x')
    return 'X'
  if (bare === 'qq')
    return 'QQ'
  if (bare === 'rss')
    return 'RSS'
  if (bare === 'v2ex')
    return 'V2EX'
  return bare
    .split('-')
    .map(part => (part ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ')
}
