import type { ThemeDefinition } from './types'

/**
 * 把主题数据写到 DOM 上。
 *
 * 落地方式是 CSS 自定义属性 + 一个 `data-theme` 属性：
 * - `<html style="--theme-hue: 25; …" data-theme="spring-festival">`，由布局服务端渲染，
 *   首帧即生效，不闪；
 * - globals.css 里用 `html[data-theme]` 把这些原料映射到既有 token（`--hue` 等），
 *   该选择器比 `[data-user-color]` 特异性更高，因此主题优先于用户选择的配色方案；
 * - 用户关闭主题时只需移除 `data-theme`，一切自动回落到配色方案，无需逐个还原。
 */

/** 主题写在 html 上的变量名，与 ThemeTokens 字段一一对应 */
export const THEME_VAR_KEYS = [
  '--theme-hue',
  '--theme-chroma',
  '--theme-primary-l',
  '--theme-primary-l-dark',
  '--theme-overlay-light',
  '--theme-overlay-dark',
  '--theme-primary-image',
] as const

type ThemeVarKey = (typeof THEME_VAR_KEYS)[number]

/** 主题 → CSS 自定义属性；未提供的字段不输出，交给 globals.css 里的默认值 */
export function themeCssVars(theme?: ThemeDefinition | null): Partial<Record<ThemeVarKey, string>> {
  if (!theme)
    return {}
  const { tokens } = theme
  const vars: Partial<Record<ThemeVarKey, string>> = {
    '--theme-hue': String(tokens.hue),
  }
  if (tokens.chroma !== undefined)
    vars['--theme-chroma'] = String(tokens.chroma)
  if (tokens.primaryL !== undefined)
    vars['--theme-primary-l'] = String(tokens.primaryL)
  if (tokens.primaryLDark !== undefined)
    vars['--theme-primary-l-dark'] = String(tokens.primaryLDark)
  if (tokens.overlay)
    vars['--theme-overlay-light'] = tokens.overlay
  if (tokens.overlayDark)
    vars['--theme-overlay-dark'] = tokens.overlayDark
  if (tokens.primaryImage)
    vars['--theme-primary-image'] = tokens.primaryImage
  return vars
}

/**
 * 主题 → html 上的 data 属性。
 * - data-theme / data-theme-effect：CSS 侧通过选择器挂样式，不需要额外 DOM；
 * - data-theme-mode：节日绑定的默认明暗，首帧脚本与 DeviceProvider 都以它为准。
 */
export function themeAttributes(theme?: ThemeDefinition | null): Record<string, string> {
  if (!theme)
    return {}
  const attrs: Record<string, string> = { 'data-theme': theme.id }
  if (theme.effect)
    attrs['data-theme-effect'] = theme.effect
  if (theme.mode)
    attrs['data-theme-mode'] = theme.mode
  return attrs
}

/**
 * 运行时应用主题（浏览器）：用户重新开启主题、或将来加载用户自定义主题时使用。
 * 服务端渲染路径不经过这里，首屏不闪。
 */
export function applyThemeToDocument(theme?: ThemeDefinition | null) {
  if (typeof document === 'undefined')
    return
  const root = document.documentElement
  for (const key of THEME_VAR_KEYS)
    root.style.removeProperty(key)
  root.removeAttribute('data-theme')
  root.removeAttribute('data-theme-effect')
  root.removeAttribute('data-theme-mode')
  if (!theme)
    return
  for (const [key, value] of Object.entries(themeCssVars(theme)))
    root.style.setProperty(key, value)
  for (const [key, value] of Object.entries(themeAttributes(theme)))
    root.setAttribute(key, value)
}
