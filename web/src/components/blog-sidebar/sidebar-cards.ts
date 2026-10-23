import type { SiteInfo } from '@/utils/common/siteinfo'
import { z } from 'zod'
import { hrefSchema } from '@/components/content-components/content-helpers'
import { resolveComponent } from '@/components/content-components/props'

/**
 * 前台文章列表页的侧边栏卡片：后台按顺序配置，保存在 site_info.sidebarCards
 * - 预设卡片：关于我、标签云、热门 / 最新文章，每种最多一张
 * - 嵌入页面：iframe（如 Misskey 时间线），只允许 http(s) 地址
 * - 组件：复用文章组件块的注册表与 props 校验，只保存组件名与 JSON props
 */

export const SIDEBAR_PRESET_CARDS = ['about', 'labels', 'hot_posts', 'latest_posts'] as const
export type SidebarPresetCard = typeof SIDEBAR_PRESET_CARDS[number]

export const SIDEBAR_IFRAME_HEIGHT = { min: 100, max: 1200, default: 300 }
export const SIDEBAR_CARD_TITLE_MAX = 60
export const SIDEBAR_CARDS_MAX = 20

const titleSchema = z.string().trim().max(SIDEBAR_CARD_TITLE_MAX).default('')

export const sidebarCardSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(SIDEBAR_PRESET_CARDS) }),
  z.object({
    type: z.literal('iframe'),
    title: titleSchema,
    url: hrefSchema(),
    height: z.number().int().min(SIDEBAR_IFRAME_HEIGHT.min).max(SIDEBAR_IFRAME_HEIGHT.max).default(SIDEBAR_IFRAME_HEIGHT.default),
  }),
  z.object({
    type: z.literal('component'),
    title: titleSchema,
    name: z.string(),
    props: z.record(z.string(), z.unknown()).default({}),
    version: z.number().int().optional(),
  }),
])

export type SidebarCardConfig = z.input<typeof sidebarCardSchema>
export type SidebarCard = z.output<typeof sidebarCardSchema>

/** 未配置过侧边栏时的默认卡片：沿用旧的「侧边栏嵌入页面」配置 */
export function defaultSidebarCards(siteInfo: Pick<SiteInfo, 'sidebarIframeUrl' | 'sidebarIframeTitle'>): SidebarCard[] {
  const cards: SidebarCard[] = [{ type: 'about' }, { type: 'labels' }, { type: 'hot_posts' }]
  const url = siteInfo.sidebarIframeUrl?.trim()
  if (url)
    cards.push({ type: 'iframe', title: siteInfo.sidebarIframeTitle?.trim() ?? '', url, height: SIDEBAR_IFRAME_HEIGHT.default })
  return cards
}

/** 校验单张卡片：组件卡片还需组件存在且 props 通过组件 schema 校验 */
export function parseSidebarCard(raw: unknown): SidebarCard | null {
  const result = sidebarCardSchema.safeParse(raw)
  if (!result.success)
    return null
  const card = result.data
  if (card.type === 'component' && !resolveComponent(card.name, card.props, card.version).ok)
    return null
  return card
}

/** 读取站点配置中的侧边栏卡片：未配置时使用默认卡片，无效的卡片忽略，预设卡片去重 */
export function getSidebarCards(siteInfo: SiteInfo): SidebarCard[] {
  if (!Array.isArray(siteInfo.sidebarCards))
    return defaultSidebarCards(siteInfo)
  const seen = new Set<string>()
  const cards: SidebarCard[] = []
  for (const raw of siteInfo.sidebarCards.slice(0, SIDEBAR_CARDS_MAX)) {
    const card = parseSidebarCard(raw)
    if (!card || (SIDEBAR_PRESET_CARDS.includes(card.type as SidebarPresetCard) && seen.has(card.type)))
      continue
    seen.add(card.type)
    cards.push(card)
  }
  return cards
}
