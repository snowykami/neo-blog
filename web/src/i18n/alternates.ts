import type { Metadata } from 'next'
import type { SeoLocaleIndexMode } from '@/utils/common/siteinfo'
import { localizePath, routing } from './routing'

/**
 * 页面 <head> 里的规范地址与多语言链接：
 * - 默认（canonical_default / noindex_follow）：文章未翻译时将所有界面语言路由的 canonical 统一收敛至无前缀的默认语言地址，
 *   且不输出多语种 hreflang 互指，避免搜索引擎判定为重复内容或分散权重；
 * - 独立索引模式（independent）：canonical 指向当前语言自己的地址，并用 hreflang 列出所有界面语言及 x-default。
 * pathname 是不带语言前缀的站内路径；相对地址由根布局的 metadataBase 补全为站点地址。
 */
export function localeAlternates(
  pathname: string,
  locale: string,
  mode: SeoLocaleIndexMode = 'canonical_default',
  rssEnabled?: boolean,
): NonNullable<Metadata['alternates']> {
  const types = rssEnabled ? { 'application/rss+xml': '/rss.xml' } : undefined
  if (mode === 'independent') {
    return {
      canonical: localizePath(pathname, locale),
      languages: languageAlternates(pathname),
      ...(types ? { types } : {}),
    }
  }
  return {
    canonical: localizePath(pathname, routing.defaultLocale),
    ...(types ? { types } : {}),
  }
}

/** 每种语言的地址（含 x-default），仅在开启多语言独立索引时由 sitemap 与页面 <head> 使用 */
export function languageAlternates(pathname: string): Record<string, string> {
  return {
    ...Object.fromEntries(routing.locales.map(code => [code, localizePath(pathname, code)])),
    'x-default': localizePath(pathname, routing.defaultLocale),
  }
}
