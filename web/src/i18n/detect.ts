import { DEFAULT_LOCALE, parseAcceptLanguage, resolveLocale } from '@/locales/registry'

/**
 * 访客偏好的界面语言（proxy.ts 用）：语言 Cookie（语言切换、账号语言同步写入）> 浏览器语言（Accept-Language 按权重）。
 * 浏览器带了语言但都不支持（如法语）时用 DEFAULT_LOCALE（en）；
 * 完全没有偏好（无 Cookie、也不带 Accept-Language 或只有通配符 `*`，如搜索引擎爬虫）时返回 undefined，由调用方用路由默认语言
 */
export function detectPreferredLocale({ cookie, acceptLanguage }: { cookie?: string | null, acceptLanguage?: string | null }): string | undefined {
  const preferred = resolveLocale(cookie)
  if (preferred)
    return preferred
  // 不带 Accept-Language，或只有通配符（Node 的 fetch 默认发 `*`）：视为没有偏好
  const tags = parseAcceptLanguage(acceptLanguage)
  if (tags.length === 0)
    return undefined
  for (const tag of tags) {
    const locale = resolveLocale(tag)
    if (locale)
      return locale
  }
  return DEFAULT_LOCALE
}
