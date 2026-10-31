import { z } from 'zod'

/**
 * 自定义主题（Theme Pack）的数据结构。
 *
 * 设计原则与配色方案（styles/*.css 中的 data-user-color）一致：主题只提供「颜色原料」，
 * 具体 token 全部由 globals.css 从 --hue / --chroma / --primary-l 派生。
 * 因此任何主题（包括用户自定义的）都只能改颜色、渐变与图标，无法改动布局、尺寸与形状。
 *
 * 主题以 JSON 数据描述而不是样式表，原因：
 * 1. 用户自定义主题需要能存库 / 走接口 / 用表单编辑，样式表做不到；
 * 2. 但颜色值本身需要 CSS 的表达力（oklch()、linear-gradient()、color-mix()），
 *    所以字段值直接就是 CSS 值字符串 —— 拿 CSS 的表达力，不拿 CSS 的不可序列化；
 * 3. 动效（@keyframes）留在 CSS 里，主题只通过 effect id 引用（见 styles/theme-effects.css）。
 */

/** 农历或公历的 [月, 日] */
export type MonthDay = [number, number]

/** 触发区间：from > to 表示跨年（如 12-30 ~ 01-02、腊月廿八 ~ 正月初七） */
export type MonthDayRange = [MonthDay, MonthDay]

/** 什么时候生效。与配色解耦，便于后台 / 用户自定义 */
export interface ThemeSchedule {
  /** 公历区间 */
  solar?: MonthDayRange
  /** 农历区间（春节、中秋等传统节日） */
  lunar?: MonthDayRange
}

/** 明暗模式 */
export const THEME_MODES = ['light', 'dark'] as const
export type ColorMode = (typeof THEME_MODES)[number]

/** 内置动效 id，实现见 app/styles/theme-effects.css */
export const THEME_EFFECTS = ['lantern', 'snow', 'sakura', 'stars', 'fireworks', 'confetti', 'flicker'] as const
export type ThemeEffect = (typeof THEME_EFFECTS)[number]

/** 可被主题替换的图标槽位；未提供时回落为默认图标 */
export const THEME_ICON_SLOTS = ['like', 'comment', 'view', 'pin', 'share'] as const
export type ThemeIconSlot = (typeof THEME_ICON_SLOTS)[number]

/** 图标名（线性风格，配合 lucide 尺寸使用），映射表见 themes/icons.tsx */
export const THEME_ICON_NAMES = [
  'lantern',
  'mooncake',
  'zongzi',
  'pumpkin',
  'sakura',
  'twin-stars',
  'chrysanthemum',
  'snowflake',
  'sparkles',
  'star',
  'terminal',
  'balloon',
  'gift',
  'heart',
  'graduation-cap',
  'flower',
  'cloud-rain',
  'bat',
  'ghost',
  'candy',
  'tree',
  'bell',
  'rabbit',
  'firework',
  'plum-blossom',
  'dumpling',
  'magpie',
  'moon',
  'leaf',
] as const
export type ThemeIconName = (typeof THEME_ICON_NAMES)[number]

/** 装饰图元名（实心卡通风格，用于正文两侧留白），映射表见 themes/decor.tsx */
export const THEME_DECOR_GLYPHS = [
  'pumpkin',
  'bat',
  'ghost',
  'spider-web',
  'candy-corn',
  'lantern',
  'firecracker',
  'plum',
  'tree',
  'snowman',
  'gift',
  'moon',
  'rabbit',
  'mooncake',
  'firework',
  'sakura-branch',
  'heart',
  'daisy',
  'cap',
  'zongzi',
  'balloon',
] as const
export type ThemeDecorGlyph = (typeof THEME_DECOR_GLYPHS)[number]

/**
 * 一个装饰图元的摆放：坐标与尺寸都是轨道内的百分比 / 像素，纯右侧数据，不参与布局。
 * 轨道本身 pointer-events: none，因此装饰永远不会挡住点击。
 */
export interface ThemeDecorItem {
  glyph: ThemeDecorGlyph
  /** 像素宽度，建议 48-160 */
  size: number
  /** 水平位置，轨道宽度的百分比 */
  x: number
  /** 垂直位置，轨道高度的百分比 */
  y: number
  /** 旋转角度 */
  rotate?: number
  /** 不透明度，0-1，默认 1 */
  opacity?: number
  /** 镜像翻转，让同一图元出现两次时不至于完全一样 */
  flip?: boolean
}

/**
 * 主题色板：只接受标量与少量 CSS 表达式，其余 token 由 --hue 派生。
 * 这样任何主题都不会破坏明暗模式的对比度，也不会影响任何形状。
 */
export interface ThemeTokens {
  /** 色相，oklch 的 h（0-360） */
  hue: number
  /** 彩度，默认 0.14；高彩度色（黄、绿）建议降低 */
  chroma?: number
  /** 亮色模式主色亮度，白底作文字时需保证对比度 ≥ 4.5:1 */
  primaryL?: number
  /** 暗色模式主色亮度 */
  primaryLDark?: number
  /** 页面装饰渐变（亮色），铺在背景之上、内容之下 */
  overlay?: string
  /** 页面装饰渐变（暗色），缺省时沿用 overlay */
  overlayDark?: string
  /** 主色元素（按钮、色块）上的渐变叠加，缺省不叠加 */
  primaryImage?: string
}

export interface ThemeDefinition {
  /** 唯一 id，同时用作 i18n key：ThemePack.names.<id> */
  id: string
  /** 多个主题区间重叠时取数值大的，默认 0 */
  priority?: number
  schedule?: ThemeSchedule
  tokens: ThemeTokens
  effect?: ThemeEffect
  /** 图标槽位 → 图元名，未指定的槽位回落为默认图标 */
  icons?: Partial<Record<ThemeIconSlot, ThemeIconName>>
  /**
   * 节日绑定的默认明暗。主题生效期间它会取代用户自己的明暗设置（系统/亮/暗），
   * 但只是「默认值」：用户仍可手动切换，手动选择会以本次节日为作用域记住，节日过后失效。
   */
  mode?: ColorMode
  /** 正文两侧留白处的装饰，左侧轨道；缺省不装饰 */
  decorLeft?: ThemeDecorItem[]
  /** 正文两侧留白处的装饰，右侧轨道 */
  decorRight?: ThemeDecorItem[]
  /** 内置主题为 true；用户自定义主题不设该字段 */
  builtin?: boolean
}

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
