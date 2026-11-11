import type { ThemeDefinition } from './types'
import { cacheLife } from 'next/cache'
import { BUILTIN_THEME_MAP, resolveActiveTheme } from './index'

/**
 * 服务端渲染用的节日 / 季节主题：主题只按日期（固定 Asia/Shanghai）变化，不必每个请求都 new Date() 算一次，
 * 跨请求缓存 10 分钟（cacheLife 'theme'），所有访客拿到同一个结果，页面可以按「所有人一致」缓存。
 * 在 'use cache' 里取当前时间不会让页面变成按请求渲染：结果随缓存条目一起保存，过期按 stale-while-revalidate 处理，
 * 跨天后的前几分钟可能仍是昨天的主题，浏览器挂载后会按本机时间再判断一次并改正（见 contexts/theme-context.tsx）。
 * 缓存里只放主题 id：主题定义含函数以外的大段数据，按 id 在内置主题表里取回即可
 */
async function loadActiveThemeId(): Promise<string | null> {
  'use cache'
  cacheLife('theme')
  return resolveActiveTheme()?.id ?? null
}

export async function getActiveTheme(): Promise<ThemeDefinition | null> {
  const id = await loadActiveThemeId()
  return id ? BUILTIN_THEME_MAP.get(id) ?? null : null
}
