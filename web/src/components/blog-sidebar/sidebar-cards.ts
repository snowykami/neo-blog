import type { SiteInfo } from '@/utils/common/siteinfo'

/**
 * 前台文章列表页的侧边栏卡片：后台按顺序配置，保存在 site_info.sidebarCards
 * - 预设卡片：关于我、标签云、热门 / 最新文章，每种最多一张
 * - 嵌入页面：iframe（如 Misskey 时间线），只允许 http(s) 地址
 * - 组件：只保存组件名与 JSON props，渲染时按需加载对应组件
 *
 * 这里只做「读取 + 轻量整理」，不引入 zod，也不引入文章组件的注册表：
 * 校验在后台保存配置时完成（见 sidebar-cards-schema.ts），组件定义在真正需要时再加载，
 * 否则整个组件注册表（连带 zod）都会进访客的首屏包（见 docs/perf-log.md）。
 */

export const SIDEBAR_PRESET_CARDS = ['about', 'labels', 'hot_posts', 'latest_posts'] as const
export type SidebarPresetCard = typeof SIDEBAR_PRESET_CARDS[number]

export const SIDEBAR_IFRAME_HEIGHT = { min: 100, max: 1200, default: 300 }
export const SIDEBAR_CARD_TITLE_MAX = 60
export const SIDEBAR_CARDS_MAX = 20

/** 后台表单里编辑的形态（字段可缺省，保存时由 schema 校验并补默认值） */
export interface SidebarPresetCardConfig {
  type: SidebarPresetCard
}

export interface SidebarIframeCardConfig {
  type: 'iframe'
  title?: string
  url: string
  height?: number
}

export interface SidebarComponentCardConfig {
  type: 'component'
  title?: string
  name: string
  props?: Record<string, unknown>
  version?: number
}

export type SidebarCardConfig = SidebarPresetCardConfig | SidebarIframeCardConfig | SidebarComponentCardConfig

/** 整理后的卡片（默认值已补全），渲染用 */
export interface SidebarPresetCardView {
  type: SidebarPresetCard
}

export interface SidebarIframeCardView {
  type: 'iframe'
  title: string
  url: string
  height: number
}

export interface SidebarComponentCardView {
  type: 'component'
  title: string
  name: string
  props: Record<string, unknown>
  version?: number
}

export type SidebarCard = SidebarPresetCardView | SidebarIframeCardView | SidebarComponentCardView

/** 未配置过侧边栏时的默认卡片：沿用旧的「侧边栏嵌入页面」配置 */
export function defaultSidebarCards(siteInfo: Pick<SiteInfo, 'sidebarIframeUrl' | 'sidebarIframeTitle'>): SidebarCard[] {
  const cards: SidebarCard[] = [{ type: 'about' }, { type: 'labels' }, { type: 'hot_posts' }]
  const url = siteInfo.sidebarIframeUrl?.trim()
  if (url)
    cards.push({ type: 'iframe', title: siteInfo.sidebarIframeTitle?.trim() ?? '', url, height: SIDEBAR_IFRAME_HEIGHT.default })
  return cards
}

function isPreset(type: string): type is SidebarPresetCard {
  return (SIDEBAR_PRESET_CARDS as readonly string[]).includes(type)
}

function asTitle(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, SIDEBAR_CARD_TITLE_MAX) : ''
}

function clampHeight(value: unknown) {
  const height = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : SIDEBAR_IFRAME_HEIGHT.default
  return Math.min(SIDEBAR_IFRAME_HEIGHT.max, Math.max(SIDEBAR_IFRAME_HEIGHT.min, height))
}

/** 只允许 http(s) 地址：iframe 由浏览器直接加载，其它协议不该出现在这里 */
function normalizeUrl(value: unknown) {
  if (typeof value !== 'string')
    return null
  const url = value.trim()
  return /^https?:\/\//i.test(url) ? url : null
}

/**
 * 整理一张已保存的卡片：字段缺失或类型不对时丢字段、补默认值；
 * 结构性错误（未知类型、iframe 缺少合规地址、组件卡片没有组件名）返回 null
 */
function normalizeCard(raw: unknown): SidebarCard | null {
  if (!raw || typeof raw !== 'object')
    return null
  const card = raw as Record<string, unknown>
  const type = typeof card.type === 'string' ? card.type : ''

  if (isPreset(type))
    return { type }

  if (type === 'iframe') {
    const url = normalizeUrl(card.url)
    return url ? { type, title: asTitle(card.title), url, height: clampHeight(card.height) } : null
  }

  if (type === 'component') {
    const name = typeof card.name === 'string' ? card.name.trim() : ''
    if (!name)
      return null
    const props = card.props && typeof card.props === 'object' && !Array.isArray(card.props) ? card.props as Record<string, unknown> : {}
    const version = typeof card.version === 'number' && Number.isFinite(card.version) ? Math.trunc(card.version) : undefined
    return { type, title: asTitle(card.title), name, props, version }
  }

  return null
}

/** 读取站点配置中的侧边栏卡片：未配置时使用默认卡片，无效的卡片忽略，预设卡片去重 */
export function getSidebarCards(siteInfo: SiteInfo): SidebarCard[] {
  if (!Array.isArray(siteInfo.sidebarCards))
    return defaultSidebarCards(siteInfo)
  const seen = new Set<string>()
  const cards: SidebarCard[] = []
  for (const raw of siteInfo.sidebarCards.slice(0, SIDEBAR_CARDS_MAX)) {
    const card = normalizeCard(raw)
    if (!card || (isPreset(card.type) && seen.has(card.type)))
      continue
    seen.add(card.type)
    cards.push(card)
  }
  return cards
}
