'use client'

import type { AbstractIntlMessages } from 'next-intl'
import { NextIntlClientProvider } from 'next-intl'
import { useEffect, useState } from 'react'
import { ErrorBoundaryPage } from '@/components/common/error-boundary-page'
import './globals.css'

// 根布局本身出错时使用，此时没有 NextIntlClientProvider，按浏览器语言按需加载对应文案
const SUPPORTED_LOCALES = ['de', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh', 'zh-tw', 'zh-wy']

function detectLocale(): string {
  for (const raw of navigator.languages ?? [navigator.language]) {
    const lang = raw.toLowerCase()
    if (SUPPORTED_LOCALES.includes(lang))
      return lang
    const base = lang.split('-')[0]
    if (SUPPORTED_LOCALES.includes(base))
      return base
  }
  return 'en'
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
    import(`@/locales/${locale}.json`)
      .then(mod => setIntl({ locale, messages: mod.default as AbstractIntlMessages }))
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
