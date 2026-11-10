import type { AbstractIntlMessages } from 'next-intl'
import type { I18nScope as I18nScopeKey } from '@/locales/scopes.generated'
import { getLocale, getNow, getTimeZone } from 'next-intl/server'
import { ClientI18nProvider } from '@/components/i18n-scope.client'
import { getScopedMessages } from '@/locales/scoped-messages'

/**
 * 只把当前这一层子树用到的文案交给客户端组件（清单见 src/locales/scopes.generated.ts）
 *
 * 为什么需要它：NextIntlClientProvider 会把拿到的整份文案序列化进 RSC payload，
 * 而访客页面用不到控制台等其它领域的文案。嵌套的 provider 会替换整棵文案树，
 * 所以每个作用域在生成时都并上了祖先与根布局用到的路径。
 *
 * 服务端组件（getTranslations）不受影响：它们走 i18n/request.ts 的完整文案，不进入响应体。
 */
export async function I18nScope({ scope, children }: { scope: I18nScopeKey, children: React.ReactNode }) {
  const locale = await getLocale()
  // 客户端 Provider 不会像服务端版本那样自动从请求配置取时区/时间基准，这里补上，避免日期渲染随环境漂移
  const [timeZone, now] = await Promise.all([getTimeZone(), getNow()])
  return (
    <ClientI18nProvider
      locale={locale}
      timeZone={timeZone}
      now={now ?? undefined}
      messages={getScopedMessages(locale, scope) as AbstractIntlMessages}
      scope={scope}
    >
      {children}
    </ClientI18nProvider>
  )
}
