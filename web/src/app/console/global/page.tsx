import { getTranslations } from 'next-intl/server'
import GlobalPage from '@/components/console/global'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('global.title'),
  }
}

export default function Page() {
  return <GlobalPage />
}
