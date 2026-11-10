import { defineRouting } from 'next-intl/routing'
import { LOCALES } from '@/locales/registry'

/**
 * 前台按 URL 区分界面语言：同一个地址对所有人返回同一种语言，页面才能静态化、被 CDN 缓存，搜索引擎也能收录每种语言。
 *
 * - 简体中文（zh-CN）不带前缀，旧链接与已收录的地址不变；其余语言带小写前缀：/en、/ja、/ko、/zh-tw、/zh-hk、/zh-mo、/zh-sg
 * - 路由参数 [locale] 取注册表里的语言代码（zh-TW），对外地址用小写前缀（/zh-tw），由 proxy.ts 改写到内部路径
 * - 后台（/console）、接口（/api）、RSS、sitemap、robots 不带语言前缀，见 isLocalizedHref
 *
 * 语言 Cookie（NEXT_LOCALE）只由浏览器写：语言切换、账号语言同步（见 i18n/locale-cookie.ts）。
 * proxy 只读它决定首次访问是否跳转，不写 Cookie，前台响应里不带 Set-Cookie，便于缓存。
 */
export const ROUTING_DEFAULT_LOCALE = 'zh-CN'

export const ROUTING_LOCALES = Object.keys(LOCALES)

/** 语言 → 对外地址前缀（小写，与旧版本保存的写法、常见站点习惯一致） */
export const LOCALE_PREFIXES: Record<string, string> = Object.fromEntries(
  ROUTING_LOCALES.map(code => [code, `/${code.toLowerCase()}`]),
)

export const routing = defineRouting({
  locales: ROUTING_LOCALES,
  defaultLocale: ROUTING_DEFAULT_LOCALE,
  localePrefix: { mode: 'as-needed', prefixes: LOCALE_PREFIXES },
  // 语言 Cookie 由浏览器自己写（见上），中间件不写；首次访问的语言跳转在 proxy.ts 里按 Cookie 与 Accept-Language 判断
  localeCookie: false,
  localeDetection: false,
  // 不在响应头里带 Link：反向代理后面拿到的是内部地址，hreflang 改由页面 <head> 与 sitemap 提供（见 i18n/alternates.ts）
  alternateLinks: false,
})

/** 不带语言前缀的站内路径：后台、接口、订阅与搜索引擎文件、健康检查，以及 next.config.ts 里的 RSS 旧地址 */
const UNLOCALIZED_SEGMENTS = new Set(['console', 'api', '_next', 'healthz', 'rss.xml', 'sitemap.xml', 'robots.txt', 'feed', 'feed.xml', 'rss', 'fonts', 'image', 'favicon.ico'])

/** 站内地址是否属于前台页面（要带上当前语言前缀）；站外地址、锚点、相对路径与后台 / 接口地址原样使用 */
export function isLocalizedHref(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//'))
    return false
  const segment = href.slice(1).split(/[/?#]/, 1)[0]
  return !UNLOCALIZED_SEGMENTS.has(segment)
}

/** 后台路径：不带语言前缀，界面语言按偏好（见 proxy.ts） */
export function isConsolePath(pathname: string): boolean {
  return pathname === '/console' || pathname.startsWith('/console/')
}

/** 某种语言下前台地址的写法：默认语言不带前缀，其余语言加前缀；href 须是不带前缀的站内地址 */
export function localizePath(href: string, locale: string): string {
  if (locale === ROUTING_DEFAULT_LOCALE || !isLocalizedHref(href))
    return href
  const prefix = LOCALE_PREFIXES[locale]
  if (!prefix)
    return href
  // 首页带查询或锚点时写成 /en?x=1，而不是 /en/?x=1
  return href === '/' || /^\/[?#]/.test(href) ? `${prefix}${href.slice(1)}` : `${prefix}${href}`
}

/**
 * 拆出地址里的语言前缀：/zh-tw/p/x → { locale: 'zh-TW', pathname: '/p/x' }；没有前缀时 locale 为 undefined。
 * 前缀不区分大小写，内部路径写法（/zh-TW）也能识别
 */
export function splitLocalePrefix(pathname: string): { locale: string | undefined, pathname: string } {
  const [, first = '', ...rest] = pathname.split('/')
  const lower = first.toLowerCase()
  const locale = ROUTING_LOCALES.find(code => LOCALE_PREFIXES[code] === `/${lower}`)
  if (!locale)
    return { locale: undefined, pathname }
  return { locale, pathname: `/${rest.join('/')}` }
}
