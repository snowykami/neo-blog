import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { resolveRouteLocale } from '@/i18n/routing'
import { NotificationsPage } from './notifications-page'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = resolveRouteLocale((await params).locale)
  setRequestLocale(locale)
  const t = await getTranslations('Notifications')
  // 个人通知页不收录
  return { title: t('title'), robots: { index: false, follow: false } }
}

export default function Page() {
  return <NotificationsPage />
}
