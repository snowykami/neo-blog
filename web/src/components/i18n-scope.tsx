import type { AbstractIntlMessages } from 'next-intl'
import type { I18nScope as I18nScopeKey } from '@/locales/scopes.generated'
import { hasLocale } from 'next-intl'
import { locale as rootLocale } from 'next/root-params'
import { Suspense } from 'react'
import { ClientI18nProvider } from '@/components/i18n-scope.client'
import { routing } from '@/i18n/routing'
import { getScopeOwnMessages } from '@/locales/scoped-messages'
import { DEFAULT_TIME_ZONE } from '@/utils/common/time-zone'

/**
 * 只把当前这一层子树用到的文案交给客户端组件（清单见 src/locales/scopes.generated.ts）
 *
 * 为什么需要它：NextIntlClientProvider 会把拿到的整份文案序列化进 RSC payload，
 * 而访客页面用不到控制台等其它领域的文案。嵌套的 provider 会替换整棵文案树，
 * 所以客户端 Provider 会并上外层 Provider 的文案（见 i18n-scope.client.tsx），这里每层只下发相对父作用域多出来的部分：
 * 客户端跳转时，新进入或参数变化的路由段（如 /p/[id]）的 layout 会重新渲染并进入 RSC，
 * 若每层都带着祖先的整份文案，每次跳转就会把根布局、(main) 已经下发过的文案再发一遍。
 *
 * 保持纯同步组件（由外层 layout 读取 params.locale 传入），避免内部调用 getLocale() 触发异步边界与 Blocking Route。
 * 构建期占位参数（`_`）或非法语言段在根布局并行触发 notFound() 前同样会执行子 layout，此时同步回退至默认语言。
 * 服务端组件（getTranslations）不受影响：它们走 i18n/request.ts 的完整文案，不进入响应体。
 */
export function I18nScope({
  scope,
  locale,
  children,
}: {
  scope: I18nScopeKey
  locale: string
  children: React.ReactNode
}) {
  const resolvedLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale
  // 服务端按统一固定时区渲染，与 request.ts 保持一致，避免调用 getTimeZone 触发未缓存动态请求上下文
  const timeZone = DEFAULT_TIME_ZONE
  return (
    <ClientI18nProvider
      locale={resolvedLocale}
      timeZone={timeZone}
      messages={getScopeOwnMessages(resolvedLocale, scope) as AbstractIntlMessages}
      scope={scope}
    >
      {children}
    </ClientI18nProvider>
  )
}

async function ScopedI18nInner({
  scope,
  params: _params,
  children,
}: {
  scope: I18nScopeKey
  params?: Promise<{ locale: string }>
  children: React.ReactNode
}) {
  // 通过 next/root-params 读取根 [locale] 参数，避免子动态段（如 [id]、[slug]、[username]）将合并后的 params 推迟至运行时 URL 阶段
  const locale = await rootLocale()
  return (
    <I18nScope scope={scope} locale={locale}>
      {children}
    </I18nScope>
  )
}

/**
 * 子目录 layout 专用的异步参数包装：将语言参数读取隔离在 `<Suspense>` 内，
 * 避免含动态段（如 /p/[id]、/c/[slug]、/u/[username]）的子 layout 在 `<Suspense>` 之外读取 URL 数据；
 * 动态路由可传入自身骨架组件作为 `fallback`，确保即时导航过渡平滑无闪烁
 */
export function ScopedI18n({
  scope,
  params,
  fallback = null,
  children,
}: {
  scope: I18nScopeKey
  params?: Promise<{ locale: string }>
  fallback?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={fallback}>
      <ScopedI18nInner scope={scope} params={params}>
        {children}
      </ScopedI18nInner>
    </Suspense>
  )
}
