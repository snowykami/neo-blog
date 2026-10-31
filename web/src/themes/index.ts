import type { ThemeDefinition } from './types'
import { CHINESE_FESTIVAL_THEMES } from './builtin/chinese'
import { INTERNATIONAL_THEMES } from './builtin/international'
import { SEASONAL_THEMES } from './builtin/seasonal'
import { resolveScheduledTheme } from './triggers'

/**
 * 自定义主题机制（Theme Pack）入口。
 *
 * 三层结构：
 *   1. 配色方案 data-user-color（styles/*.css，只给 --hue）—— 用户手动选，长期有效
 *   2. 主题包 data-theme（本目录，给 --hue / 彩度 / 渐变 / 图标 / 动效）—— 按日期自动触发，可关闭
 *   3. 明暗模式 .dark —— 决定上面两层的取值
 *
 * 主题是纯数据，因此将来「用户自定义主题」只需要换一个数据来源（接口 / localStorage），
 * 用 parseThemeDefinition() 校验后原样传给 <ThemeProvider>，渲染与触发逻辑完全复用。
 */
export const BUILTIN_THEMES: ThemeDefinition[] = [
  ...CHINESE_FESTIVAL_THEMES,
  ...INTERNATIONAL_THEMES,
  ...SEASONAL_THEMES,
]

/** 内置主题表：按 id 索引，便于后台预览或按 id 指定主题 */
export const BUILTIN_THEME_MAP: ReadonlyMap<string, ThemeDefinition> = new Map(
  BUILTIN_THEMES.map(theme => [theme.id, theme]),
)

/** 当前时间生效的主题；没有节日时返回 null（页面保持用户选择的配色方案） */
export function resolveActiveTheme(
  now: Date = new Date(),
  themes: readonly ThemeDefinition[] = BUILTIN_THEMES,
): ThemeDefinition | null {
  return resolveScheduledTheme(themes, now)
}

// 图标表是客户端模块（含手绘 SVG 与 lucide 组件），不从入口再导出，避免服务端组件被迫进入客户端包
export { applyThemeToDocument, THEME_VAR_KEYS, themeAttributes, themeCssVars } from './apply'
export { isWithinRange, matchesSchedule, resolveScheduledTheme } from './triggers'
export {
  parseThemeDefinition,
  THEME_EFFECTS,
  THEME_ICON_SLOTS,
  themeDefinitionSchema,
} from './types'
export type {
  MonthDay,
  MonthDayRange,
  ThemeDefinition,
  ThemeEffect,
  ThemeIconName,
  ThemeIconSlot,
  ThemeSchedule,
  ThemeTokens,
} from './types'
