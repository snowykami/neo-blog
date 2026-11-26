import type { Metadata } from 'next'
import { locale as rootLocale } from 'next/root-params'
import { I18nScope } from '@/components/i18n-scope'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
}

export default async function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await rootLocale()
  return (
    <I18nScope scope="auth" locale={locale}>
      <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-4 md:p-10">
        <div className="flex w-full max-w-sm flex-col gap-6 pt-4">{children}</div>
      </div>
    </I18nScope>
  )
}
