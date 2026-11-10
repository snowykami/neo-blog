'use client'

import type { AbstractIntlMessages, IntlError } from 'next-intl'
import deepmerge from 'deepmerge'
import { NextIntlClientProvider } from 'next-intl'
import { useCallback, useMemo, useRef, useState } from 'react'
import { isMissingMessage, loadMessageUnit, messagePath, readableFallback, reportIntlError } from '@/i18n/fallback'
import { unitOfPath } from '@/locales/scopes'

/**
 * 客户端的文案 Provider：文案由服务端按作用域切好传进来（见 i18n-scope.tsx）
 *
 * 作用域清单是构建期静态分析出来的，万一漏了某个命名空间（例如键由变量决定、分析没跟上），这里兜底：
 *   - 显示由键名转成的可读文本，不显示原始键路径；每条缺失只记一次日志（带作用域名，便于定位）
 *   - 在浏览器里按需加载该语言的完整文案，补上缺的下发单元后重新渲染，用户最终看到的是正确文案
 * onError / getMessageFallback 必须是客户端函数，没法从服务端组件传进来，所以单独放这一个客户端壳。
 */
export function ClientI18nProvider({
  locale,
  timeZone,
  now,
  messages,
  scope,
  children,
}: {
  locale: string
  /** 时区与「现在」由服务端按请求算好传进来，避免日期在客户端与服务端渲染出不同结果 */
  timeZone: string
  now?: Date
  messages: AbstractIntlMessages
  scope: string
  children: React.ReactNode
}) {
  // 补加载的文案按语言记录：切换语言后旧语言补来的文案不能混进来
  const [extra, setExtra] = useState<{ locale: string, messages: AbstractIntlMessages } | null>(null)
  const requested = useRef(new Set<string>())

  const merged = useMemo(
    () => (extra && extra.locale === locale ? deepmerge(messages, extra.messages) : messages),
    [messages, extra, locale],
  )

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

  const onError = useCallback((error: IntlError) => reportIntlError(error, scope), [scope])

  const getMessageFallback = useCallback(({ namespace, key, error }: { namespace?: string, key: string, error: IntlError }) => {
    const path = messagePath(namespace, key)
    if (isMissingMessage(error))
      requestUnit(path)
    return readableFallback(path)
  }, [requestUnit])

  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone={timeZone}
      now={now}
      messages={merged}
      onError={onError}
      getMessageFallback={getMessageFallback}
    >
      {children}
    </NextIntlClientProvider>
  )
}
