import type { ThemeDefinition } from './types'
import { z } from 'zod'
import { THEME_DECOR_GLYPHS, THEME_EFFECTS, THEME_ICON_NAMES, THEME_ICON_SLOTS, THEME_MODES } from './types'

/**
 * 主题数据的校验 schema：只在需要校验外部来源（后台 / 本地存储 / 接口）的主题时引用。
 * 与类型定义（types.ts）分开：前台的主题渲染只需要类型与常量，引用这里会把 zod 带进访客的首屏包
 */

const monthDaySchema = z.tuple([
  z.number().int().min(1).max(12),
  z.number().int().min(1).max(31),
])

const monthDayRangeSchema = z.tuple([monthDaySchema, monthDaySchema])

const scheduleSchema = z.object({
  solar: monthDayRangeSchema.optional(),
  lunar: monthDayRangeSchema.optional(),
})

// 颜色值最终会写入 CSSOM，不走 innerHTML；仍限制长度与类型，避免脏数据撑爆样式表
const cssValueSchema = z.string().trim().min(1).max(2000)

const tokensSchema = z.object({
  hue: z.number().min(0).max(360),
  chroma: z.number().min(0).max(0.4).optional(),
  primaryL: z.number().min(0.3).max(0.95).optional(),
  primaryLDark: z.number().min(0.3).max(0.95).optional(),
  overlay: cssValueSchema.optional(),
  overlayDark: cssValueSchema.optional(),
  primaryImage: cssValueSchema.optional(),
})

const iconSlotSchema = z.partialRecord(z.enum(THEME_ICON_SLOTS), z.enum(THEME_ICON_NAMES))

const decorItemSchema = z.object({
  glyph: z.enum(THEME_DECOR_GLYPHS),
  size: z.number().min(16).max(240),
  x: z.number().min(-20).max(120),
  y: z.number().min(-20).max(120),
  rotate: z.number().min(-180).max(180).optional(),
  opacity: z.number().min(0).max(1).optional(),
  flip: z.boolean().optional(),
})

const decorSchema = z.array(decorItemSchema).max(12)

/** 用户自定义主题的校验 schema：后端 / 本地存储下发前先过一遍 */
export const themeDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/, 'id 只允许小写字母、数字与连字符'),
  priority: z.number().int().min(0).max(1000).optional(),
  schedule: scheduleSchema.optional(),
  tokens: tokensSchema,
  effect: z.enum(THEME_EFFECTS).optional(),
  mode: z.enum(THEME_MODES).optional(),
  icons: iconSlotSchema.optional(),
  decorLeft: decorSchema.optional(),
  decorRight: decorSchema.optional(),
  builtin: z.boolean().optional(),
})

/** 解析外部传入的主题数据，非法时返回 null（不抛异常，避免一个坏主题拖垮整个页面） */
export function parseThemeDefinition(input: unknown): ThemeDefinition | null {
  const result = themeDefinitionSchema.safeParse(input)
  return result.success ? (result.data as ThemeDefinition) : null
}
