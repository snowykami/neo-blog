import type { ThemeDefinition } from './types'
import { unstable_cache } from 'next/cache'
import { BUILTIN_THEME_MAP, resolveActiveTheme } from './index'

/**
 * 服务端渲染用的节日 / 季节主题：主题只按日期（固定 Asia/Shanghai）变化，不必每个请求都 new Date() 算一次，
 * 跨请求缓存 10 分钟，所有访客拿到同一个结果，页面可以按「所有人一致」缓存。
 * 缓存过期按 stale-while-revalidate 处理，跨天后的前几分钟可能仍是昨天的主题：
 * 浏览器挂载后会按本机时间再判断一次并改正（见 contexts/theme-context.tsx）。
 * 迁移到 Cache Components 后换成 `use cache` + `cacheLife`。
 */
const ACTIVE_THEME_REVALIDATE_SECONDS = 600

// 缓存里只放主题 id：主题定义含函数以外的大段数据，按 id 在内置主题表里取回即可
const loadActiveThemeId = unstable_cache(
  async (): Promise<string | null> => resolveActiveTheme()?.id ?? null,
  ['active-theme'],
  { revalidate: ACTIVE_THEME_REVALIDATE_SECONDS },
)

export async function getActiveTheme(): Promise<ThemeDefinition | null> {
  const id = await loadActiveThemeId().catch(() => resolveActiveTheme()?.id ?? null)
  return id ? BUILTIN_THEME_MAP.get(id) ?? null : null
}
