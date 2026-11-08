import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { NotificationsPage } from './notifications-page'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Notifications')
  // 个人通知页不收录
  return { title: t('title'), robots: { index: false, follow: false } }
}

export default function Page() {
  return <NotificationsPage />
}
