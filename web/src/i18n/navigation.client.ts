'use client'

import { useLocale } from 'next-intl'
import { createNavigation } from 'next-intl/navigation'
import { useRouter as useNextRouter } from 'next/navigation'
import { useMemo } from 'react'
import { isLocalizedHref, localizePath, routing, splitLocalePrefix } from './routing'

// useRouter 只能在客户端组件里用，单独放在 'use client' 模块里，i18n/navigation.tsx 再转出（服务端组件也会导入那个文件）
const { useRouter: useIntlRouter } = createNavigation(routing)

type IntlRouter = ReturnType<typeof useIntlRouter>
type NextRouter = ReturnType<typeof useNextRouter>
type NavigateOptions = Parameters<IntlRouter['push']>[1]
export type PrefetchOptions = Parameters<IntlRouter['prefetch']>[1] & Parameters<NextRouter['prefetch']>[1]

/** 前台地址自动带上当前语言前缀；后台、接口等不带语言前缀的地址交给 next/navigation（见 isLocalizedHref） */
export function useRouter() {
  const intlRouter = useIntlRouter()
  const nextRouter = useNextRouter()
  const currentLocale = useLocale()
  return useMemo(() => ({
    ...intlRouter,
    push: (href: string, options?: NavigateOptions) => (isLocalizedHref(href) ? intlRouter.push(href, options) : nextRouter.push(href, options)),
    replace: (href: string, options?: NavigateOptions) => (isLocalizedHref(href) ? intlRouter.replace(href, options) : nextRouter.replace(href, options)),
    prefetch: (href: string, options?: PrefetchOptions) => {
      if (!options)
        return isLocalizedHref(href) ? intlRouter.prefetch(href) : nextRouter.prefetch(href)
      const { locale, ...nextOptions } = options
      const hasNextOptions = nextOptions.kind !== undefined || nextOptions.onInvalidate !== undefined
      if (isLocalizedHref(href)) {
        // next-intl 的 router.prefetch 签名未暴露 kind / onInvalidate，携带完整预取策略时直接经 localizePath 转交原生 nextRouter
        if (hasNextOptions) {
          const targetLocale = typeof locale === 'string' ? locale : currentLocale
          const alreadyPrefixed = splitLocalePrefix(href.split(/[?#]/, 1)[0]).locale !== undefined
          const targetHref = alreadyPrefixed && !locale ? href : localizePath(href, targetLocale)
          nextRouter.prefetch(targetHref, nextOptions)
          return
        }
        intlRouter.prefetch(href, locale ? { locale } : undefined)
        return
      }
      nextRouter.prefetch(href, hasNextOptions ? nextOptions : undefined)
    },
  }), [currentLocale, intlRouter, nextRouter])
}
