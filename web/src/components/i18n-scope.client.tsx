'use client'

import type { AbstractIntlMessages } from 'next-intl'
import process from 'node:process'
import { NextIntlClientProvider } from 'next-intl'

/**
 * 客户端的文案 Provider：文案由服务端按作用域切好传进来（见 i18n-scope.tsx）
 *
 * 开发环境把缺失的文案键打到控制台并带上作用域名：作用域是按需切分的，
 * 某个页面用到清单外的键时这里会立刻暴露，而不是等上线后看到原始键名。
 * onError 必须是客户端函数，没法从服务端组件传进来，所以单独放这一个客户端壳。
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
  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone={timeZone}
      now={now}
      messages={messages}
      // 生产环境保持静默，避免把文案键名刷到用户控制台
      onError={process.env.NODE_ENV === 'production'
        ? undefined
        : error => console.error(`[i18n:${scope}] ${error.message}`)}
    >
      {children}
    </NextIntlClientProvider>
  )
}
