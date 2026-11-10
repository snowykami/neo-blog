import type { AbstractIntlMessages } from 'next-intl'
import type { I18nScope as I18nScopeKey } from '@/locales/scopes.generated'
import { getLocale, getTimeZone } from 'next-intl/server'
import { ClientI18nProvider } from '@/components/i18n-scope.client'
import { getScopeOwnMessages } from '@/locales/scoped-messages'

/**
 * 只把当前这一层子树用到的文案交给客户端组件（清单见 src/locales/scopes.generated.ts）
 *
 * 为什么需要它：NextIntlClientProvider 会把拿到的整份文案序列化进 RSC payload，
 * 而访客页面用不到控制台等其它领域的文案。嵌套的 provider 会替换整棵文案树，
 * 所以客户端 Provider 会并上外层 Provider 的文案（见 i18n-scope.client.tsx），这里每层只下发相对父作用域多出来的部分：
 * 客户端跳转时，新进入或参数变化的路由段（如 /p/[id]）的 layout 会重新渲染并进入 RSC，
 * 若每层都带着祖先的整份文案，每次跳转就会把根布局、(main) 已经下发过的文案再发一遍。
 *
 * 服务端组件（getTranslations）不受影响：它们走 i18n/request.ts 的完整文案，不进入响应体。
 */
export async function I18nScope({ scope, children }: { scope: I18nScopeKey, children: React.ReactNode }) {
  const locale = await getLocale()
  // 客户端 Provider 不会像服务端版本那样自动从请求配置取时区，这里补上服务端渲染用的固定时区，保证水合前后一致。
  // 不传 now：它是每个请求不同的「现在」，会让页面因人因时而异；用到「现在」的组件在浏览器里自己取（如 useNow）
  const timeZone = await getTimeZone()
  return (
    <ClientI18nProvider
      locale={locale}
      timeZone={timeZone}
      messages={getScopeOwnMessages(locale, scope) as AbstractIntlMessages}
      scope={scope}
    >
      {children}
    </ClientI18nProvider>
  )
}
