import { getTranslations } from 'next-intl/server'
import { Dashboard } from '@/components/console/dashboard'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('dashboard.title'),
  }
}

export default function Page() {
  return <Dashboard />
}
