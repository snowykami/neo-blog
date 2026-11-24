import { I18nScope } from '@/components/i18n-scope'

export default async function AuthLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ locale: string }>
}>) {
  const { locale } = await params
  return (
    <I18nScope scope="auth" locale={locale}>
      <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-4 md:p-10">
        <div className="flex w-full max-w-sm flex-col gap-6 pt-4">{children}</div>
      </div>
    </I18nScope>
  )
}
