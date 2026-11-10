import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { getCachedSiteInfo } from '@/api/misc.server'
import { getLoginUserServer } from '@/api/user.server'
import { messagePath, readableFallback, reportIntlError } from '@/i18n/fallback'
import { DEFAULT_LOCALE, getLocaleMessages, parseAcceptLanguage, resolveLocale } from '@/locales'
import { resolveDisplayTimeZone, TIME_ZONE_COOKIE } from '@/utils/common/time-zone'

export default getRequestConfig(async () => {
  const locale = await getUserLocale()
  // 地区变体缺少的文案按回退链补齐（见 locales/registry.ts）
  return {
    locale,
    messages: getLocaleMessages(locale),
    // 时间按访客浏览器的时区显示；不设置时 next-intl 会用服务器所在的时区（线上是 UTC），浏览器里的时间就会差几个小时
    timeZone: resolveDisplayTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value),
    // 服务端拿的是完整文案，缺失只可能是文案没补：同样只记一次日志、显示可读文本而不是原始键路径（见 i18n/fallback.ts）
    onError: error => reportIntlError(error, 'server'),
    getMessageFallback: ({ namespace, key }) => readableFallback(messagePath(namespace, key)),
  }
})

// 当前请求的界面语言：用户设置 > 浏览器语言（Accept-Language 按权重从高到低）> 默认语言
// 语言标签不区分大小写，旧版本保存的 zh、zh-tw 等写法也能识别。
// 请求完全不带 Accept-Language 时（搜索引擎爬虫抓取时就不带）用站点语言，让收录的页面与正文语言一致；
// 带了但都不支持的语言（如法语）仍回退到默认语言 en
export async function getUserLocale(): Promise<string> {
  try {
    const user = (await getLoginUserServer()).data
    // 站点只保留部分界面语言：用户设置的语言若已被移除，按浏览器语言回退
    const preferred = resolveLocale(user?.language)
    if (preferred)
      return preferred
  }
  catch {}

  const headersList = await headers()
  const acceptLanguage = headersList.get('accept-language')?.trim()
  if (!acceptLanguage)
    return resolveLocale((await getCachedSiteInfo()).defaultLanguage) ?? DEFAULT_LOCALE
  for (const tag of parseAcceptLanguage(acceptLanguage)) {
    const locale = resolveLocale(tag)
    if (locale)
      return locale
  }
  return DEFAULT_LOCALE
}
