import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { NotificationSettingsPage } from './notification-settings-page'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('NotificationSettings')
  return { title: t('title'), robots: { index: false, follow: false } }
}

export default function Page() {
  return <NotificationSettingsPage />
}
