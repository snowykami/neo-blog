import { BUILTIN_THEME_MAP } from './index'

/**
 * 节日主题预览（后台调试用）。
 *
 * 背景：节日主题按日期自动触发，一年只有几天能看到效果，改配色时几乎没法验证。
 * 所以给管理员留一个「强制指定当前主题」的开关，把选择存进 cookie：
 * - 用 cookie 而不是 localStorage，是为了让**服务端渲染**就能拿到，首帧直接是对的，
 *   刷新/打开任何页面都不闪，控制台里的其它页面也能立刻看到效果；
 * - 只在管理员角色下生效（见 utils/server/theme-preview.ts），普通访客即使手写了 cookie 也没用；
 * - 与「节日主题开关」（localStorage 的 theme-pack）互相独立：预览只决定「用哪一个主题」，
 *   是否启用仍由顶栏配色弹层里的那个开关决定。
 */

/** cookie 名，同时也是客户端组件与服务端读取共用的常量 */
export const THEME_PREVIEW_COOKIE = 'theme-pack-preview'

/** 预览有效期 30 天：够一个调试周期，又不会永久生效到忘掉 */
export const THEME_PREVIEW_MAX_AGE = 60 * 60 * 24 * 30

/** Select 里表示「不预览，跟随日期」的值 */
export const THEME_PREVIEW_AUTO = 'auto'

/** Select 里表示「从不使用」：本浏览器永远不应用节日主题（等同预览一个「没有节日」的状态） */
export const THEME_PREVIEW_NEVER = 'never'

/** 是否是一个「强制不应用主题」的取值 */
export function isPreviewNever(value?: string | null): boolean {
  return value === THEME_PREVIEW_NEVER
}

/** 是否是合法的、可预览的内置主题 id */
export function isPreviewableThemeId(id?: string | null): id is string {
  return Boolean(id) && id !== THEME_PREVIEW_AUTO && id !== THEME_PREVIEW_NEVER && BUILTIN_THEME_MAP.has(id as string)
}

/** 允许写进 cookie 的取值：自动 / 从不使用 / 具体主题 */
export function isPreviewChoice(value?: string | null): value is string {
  return value === THEME_PREVIEW_AUTO || value === THEME_PREVIEW_NEVER || isPreviewableThemeId(value)
}

/** 读取当前浏览器上的预览选择（仅用于界面回显，真正的判定在服务端） */
export function readPreviewCookie(): string {
  if (typeof document === 'undefined')
    return THEME_PREVIEW_AUTO
  const raw = document.cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${THEME_PREVIEW_COOKIE}=`))
  const value = raw ? decodeURIComponent(raw.slice(THEME_PREVIEW_COOKIE.length + 1)) : ''
  if (isPreviewableThemeId(value))
    return value
  if (isPreviewNever(value))
    return THEME_PREVIEW_NEVER
  return THEME_PREVIEW_AUTO
}

/** 写入 / 清除预览选择；传 null 或 'auto' 表示恢复按日期自动切换，'never' 表示本浏览器永不用节日主题 */
export function writePreviewCookie(id: string | null) {
  if (typeof document === 'undefined')
    return
  if (!isPreviewableThemeId(id)) {
    if (isPreviewNever(id)) {
      document.cookie = `${THEME_PREVIEW_COOKIE}=${THEME_PREVIEW_NEVER}; path=/; max-age=${THEME_PREVIEW_MAX_AGE}; samesite=lax`
      return
    }
    document.cookie = `${THEME_PREVIEW_COOKIE}=; path=/; max-age=0; samesite=lax`
    return
  }
  document.cookie = `${THEME_PREVIEW_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${THEME_PREVIEW_MAX_AGE}; samesite=lax`
}
