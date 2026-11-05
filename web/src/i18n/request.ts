import { getRequestConfig } from 'next-intl/server'
import { headers } from 'next/headers'
import { getLoginUserServer } from '@/api/user.server'
import { DEFAULT_LOCALE, getLocaleMessages, parseAcceptLanguage, resolveLocale } from '@/locales'

export default getRequestConfig(async () => {
  const locale = await getUserLocale()
  // 地区变体缺少的文案按回退链补齐（见 locales/registry.ts）
  return {
    locale,
    messages: getLocaleMessages(locale),
  }
})

// 当前请求的界面语言：用户设置 > 浏览器语言（Accept-Language 按权重从高到低）> 默认语言
// 语言标签不区分大小写，旧版本保存的 zh、zh-tw 等写法也能识别
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
  for (const tag of parseAcceptLanguage(headersList.get('accept-language'))) {
    const locale = resolveLocale(tag)
    if (locale)
      return locale
  }
  return DEFAULT_LOCALE
}
