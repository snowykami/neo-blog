'use client'

import type { AbstractIntlMessages } from 'next-intl'
import { NextIntlClientProvider } from 'next-intl'
import { useEffect, useState } from 'react'
import { ErrorBoundaryPage } from '@/components/common/error-boundary-page'
import { DEFAULT_LOCALE, getFallbackChain, LOCALES, mergeLocaleMessages, resolveLocale } from '@/locales/registry'
import './globals.css'

// 根布局本身出错时使用，此时没有 NextIntlClientProvider，按浏览器语言按需加载对应文案
function detectLocale(): string {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const locale = resolveLocale(tag)
    if (locale)
      return locale
  }
  return DEFAULT_LOCALE
}

// 按回退链加载各语言的文案文件再合并，地区变体只含与上一级不同的 key
async function loadMessages(locale: string): Promise<AbstractIntlMessages> {
  const chain = await Promise.all(getFallbackChain(locale).map(code =>
    import(`@/locales/${LOCALES[code].file}.json`).then(mod => mod.default as AbstractIntlMessages),
  ))
  return mergeLocaleMessages(chain)
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [intl, setIntl] = useState<{ locale: string, messages: AbstractIntlMessages } | null>(null)

  useEffect(() => {
    const locale = detectLocale()
    loadMessages(locale)
      .then(messages => setIntl({ locale, messages }))
      .catch(() => import('@/locales/en.json').then(mod => setIntl({ locale: 'en', messages: mod.default as AbstractIntlMessages })))
  }, [])

  return (
    <html lang={intl?.locale || 'en'} className="h-full">
      <body className="h-full">
        {intl && (
          <NextIntlClientProvider locale={intl.locale} messages={intl.messages}>
            <ErrorBoundaryPage error={error} reset={reset} />
          </NextIntlClientProvider>
        )}
      </body>
    </html>
  )
}
