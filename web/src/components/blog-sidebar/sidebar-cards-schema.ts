import type { SidebarCard } from './sidebar-cards'
import { z } from 'zod'
import { hrefSchema } from '@/components/content-components/content-helpers'
import { resolveComponent } from '@/components/content-components/props'
import { SIDEBAR_CARD_TITLE_MAX, SIDEBAR_CARDS_MAX, SIDEBAR_IFRAME_HEIGHT, SIDEBAR_PRESET_CARDS } from './sidebar-cards'

/**
 * 侧边栏卡片的校验：只在后台保存配置时使用。
 *
 * 访客侧不需要它——那会把整个文章组件注册表（连带 zod）带进首屏包，运行时用
 * sidebar-cards.ts 里的轻量整理即可（见 docs/perf-log.md）。
 */

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

export const sidebarCardsSchema = z.array(sidebarCardSchema).max(SIDEBAR_CARDS_MAX)

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
