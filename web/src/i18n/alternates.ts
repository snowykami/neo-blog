import type { Metadata } from 'next'
import { localizePath, routing } from './routing'

/**
 * 页面 <head> 里的多语言链接：canonical 指向当前语言自己的地址，hreflang 列出每种语言的地址，
 * x-default 指向不带前缀的默认语言地址（没有匹配语言的访客由 proxy.ts 按偏好跳转）。
 * pathname 是不带语言前缀的站内路径；相对地址由根布局的 metadataBase 补全为站点地址
 */
export function localeAlternates(pathname: string, locale: string): NonNullable<Metadata['alternates']> {
  return {
    canonical: localizePath(pathname, locale),
    languages: languageAlternates(pathname),
  }
}

/** 每种语言的地址（含 x-default），sitemap 与页面 <head> 共用 */
export function languageAlternates(pathname: string): Record<string, string> {
  return {
    ...Object.fromEntries(routing.locales.map(code => [code, localizePath(pathname, code)])),
    'x-default': localizePath(pathname, routing.defaultLocale),
  }
}
