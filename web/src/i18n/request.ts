import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { locale as rootLocale } from 'next/root-params'
import { messagePath, readableFallback, reportIntlError } from '@/i18n/fallback'
import { routing } from '@/i18n/routing'
import { getLocaleMessages } from '@/locales'
import { DEFAULT_TIME_ZONE } from '@/utils/common/time-zone'

export default getRequestConfig(async ({ locale: requested }) => {
  const locale = hasLocale(routing.locales, requested) ? requested : await urlLocale()
  // 地区变体缺少的文案按回退链补齐（见 locales/registry.ts）
  return {
    locale,
    messages: getLocaleMessages(locale),
    // 服务端统一按固定时区渲染（所有人一致，不读时区 Cookie）；浏览器水合后改用本机时区重新格式化（见 ClientI18nProvider）。
    // 必须显式设置：不设置时 next-intl 用服务器所在的时区，各环境渲染结果不同。也不设置 now，避免每个请求带上不同的「现在」
    timeZone: DEFAULT_TIME_ZONE,
    // 服务端拿的是完整文案，缺失只可能是文案没补：同样只记一次日志、显示可读文本而不是原始键路径（见 i18n/fallback.ts）
    onError: error => reportIntlError(error, 'server'),
    getMessageFallback: ({ namespace, key }) => readableFallback(messagePath(namespace, key)),
  }
})

/**
 * 界面语言只看 URL：根布局所在的 [locale] 段（前台由地址前缀决定，后台由 proxy.ts 按偏好改写进来），
 * 同一个地址对所有人返回同一种语言，不读 Cookie 与 Accept-Language，页面因此可以静态化。
 * Route Handler 里取不到根参数（Next 暂不支持），调用方应显式传 locale（如 getTranslations({ locale })），
 * 否则回退到默认语言
 */
async function urlLocale(): Promise<string> {
  try {
    const value = await rootLocale()
    if (hasLocale(routing.locales, value))
      return value
  }
  catch {}
  return routing.defaultLocale
}
