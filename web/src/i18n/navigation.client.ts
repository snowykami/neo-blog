'use client'

import { createNavigation } from 'next-intl/navigation'
import { useRouter as useNextRouter } from 'next/navigation'
import { useMemo } from 'react'
import { isLocalizedHref, routing } from './routing'

// useRouter 只能在客户端组件里用，单独放在 'use client' 模块里，i18n/navigation.tsx 再转出（服务端组件也会导入那个文件）
const { useRouter: useIntlRouter } = createNavigation(routing)

type IntlRouter = ReturnType<typeof useIntlRouter>
type NavigateOptions = Parameters<IntlRouter['push']>[1]
type PrefetchOptions = Parameters<IntlRouter['prefetch']>[1]

/** 前台地址自动带上当前语言前缀；后台、接口等不带语言前缀的地址交给 next/navigation（见 isLocalizedHref） */
export function useRouter() {
  const intlRouter = useIntlRouter()
  const nextRouter = useNextRouter()
  return useMemo(() => ({
    ...intlRouter,
    push: (href: string, options?: NavigateOptions) => (isLocalizedHref(href) ? intlRouter.push(href, options) : nextRouter.push(href, options)),
    replace: (href: string, options?: NavigateOptions) => (isLocalizedHref(href) ? intlRouter.replace(href, options) : nextRouter.replace(href, options)),
    prefetch: (href: string, options?: PrefetchOptions) => (isLocalizedHref(href) ? intlRouter.prefetch(href, options) : nextRouter.prefetch(href)),
  }), [intlRouter, nextRouter])
}
