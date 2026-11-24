import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { resolveRouteLocale } from '@/i18n/routing'
import { NotificationSettingsPage } from './notification-settings-page'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = resolveRouteLocale((await params).locale)
  setRequestLocale(locale)
  const t = await getTranslations('NotificationSettings')
  // 地址栏可能带着免登录凭据：不让它随外链或 Referer 泄漏出去
  return { title: t('title'), robots: { index: false, follow: false }, referrer: 'no-referrer' }
}

export default function Page() {
  return <NotificationSettingsPage />
}
