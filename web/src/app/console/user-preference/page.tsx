import { getTranslations } from 'next-intl/server'
import { UserPreferencePage } from '@/components/console/user-preference'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('user_preference.title'),
  }
}

export default function Page() {
  return <UserPreferencePage />
}
