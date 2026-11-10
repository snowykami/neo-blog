'use client'

import type { AbstractIntlMessages, IntlError } from 'next-intl'
import deepmerge from 'deepmerge'
import { IntlErrorCode, NextIntlClientProvider } from 'next-intl'
import { createContext, use, useCallback, useMemo, useRef, useState } from 'react'
import { useBrowserTimeZone } from '@/hooks/use-browser-time-zone'
import { isMissingMessage, loadMessageUnit, messagePath, readableFallback, reportIntlError } from '@/i18n/fallback'
import { unitOfPath } from '@/locales/scopes'
import { resolveDisplayTimeZone } from '@/utils/common/time-zone'

/** 外层作用域合并后的文案：嵌套的 Provider 并上它，服务端每层只需下发自己多出来的部分（见 i18n-scope.tsx） */
const ScopeMessagesContext = createContext<AbstractIntlMessages | null>(null)

/**
 * 客户端的文案 Provider：文案由服务端按作用域切好传进来（见 i18n-scope.tsx），并上外层作用域已有的文案
 *
 * 作用域清单是构建期静态分析出来的，万一漏了某个命名空间（例如键由变量决定、分析没跟上），这里兜底：
 *   - 显示由键名转成的可读文本，不显示原始键路径；每条缺失只记一次日志（带作用域名，便于定位）
 *   - 在浏览器里按需加载该语言的完整文案，补上缺的下发单元后重新渲染，用户最终看到的是正确文案
 * onError / getMessageFallback 必须是客户端函数，没法从服务端组件传进来，所以单独放这一个客户端壳。
 */
export function ClientI18nProvider({
  locale,
  timeZone: serverTimeZone,
  messages,
  scope,
  children,
}: {
  locale: string
  /** 服务端渲染用的固定时区：水合阶段沿用它，保证与服务端 HTML 一致 */
  timeZone: string
  /** 这一层相对父作用域多出来的文案；根作用域为完整文案 */
  messages: AbstractIntlMessages
  scope: string
  children: React.ReactNode
}) {
  // 补加载的文案按语言记录：切换语言后旧语言补来的文案不能混进来
  // 时间按访客本机时区显示：水合阶段 useBrowserTimeZone 返回空字符串，沿用服务端时区；水合后立刻换成本机时区重新格式化。
  // 本机时区与服务端相同（多数访客）时取值不变，不会引起重新渲染
  const timeZone = resolveDisplayTimeZone(useBrowserTimeZone(), serverTimeZone)
  const [extra, setExtra] = useState<{ locale: string, messages: AbstractIntlMessages } | null>(null)
  const requested = useRef(new Set<string>())
  const inherited = use(ScopeMessagesContext)

  const merged = useMemo(() => {
    const scoped = inherited ? deepmerge(inherited, messages) : messages
    return extra && extra.locale === locale ? deepmerge(scoped, extra.messages) : scoped
  }, [inherited, messages, extra, locale])

  const requestUnit = useCallback((path: string) => {
    // 服务端渲染时不加载：首屏先显示可读文本，水合后由浏览器补齐
    if (typeof window === 'undefined')
      return
    const id = `${locale}\u0000${unitOfPath(path)}`
    if (requested.current.has(id))
      return
    requested.current.add(id)
    // getMessageFallback 在渲染过程中调用，更新状态要推迟到渲染之后
    setTimeout(() => {
      loadMessageUnit(locale, path)
        .then((loaded) => {
          if (!loaded)
            return
          const unit = loaded as AbstractIntlMessages
          setExtra(prev => ({
            locale,
            messages: prev && prev.locale === locale ? deepmerge(prev.messages, unit) : unit,
          }))
        })
        .catch(() => {})
    }, 0)
  }, [locale])

  // 不再下发全局 now（见 i18n-scope.tsx）：浏览器里 relativeTime 未传 now 时按格式化那一刻的时间算，这正是想要的，不算错误。
  // 这类数据都是挂载后在浏览器里取的，不参与服务端渲染，不会造成水合不一致（服务端的同类错误照常记录）
  const onError = useCallback((error: IntlError) => {
    if (error.code === IntlErrorCode.ENVIRONMENT_FALLBACK)
      return
    reportIntlError(error, scope)
  }, [scope])

  const getMessageFallback = useCallback(({ namespace, key, error }: { namespace?: string, key: string, error: IntlError }) => {
    const path = messagePath(namespace, key)
    if (isMissingMessage(error))
      requestUnit(path)
    return readableFallback(path)
  }, [requestUnit])

  return (
    <ScopeMessagesContext value={merged}>
      <NextIntlClientProvider
        locale={locale}
        timeZone={timeZone}
        messages={merged}
        onError={onError}
        getMessageFallback={getMessageFallback}
      >
        {children}
      </NextIntlClientProvider>
    </ScopeMessagesContext>
  )
}
