import { getTranslations } from 'next-intl/server'
import { RuntimeCard } from '@/components/console/dashboard/runtime-card'

export async function generateMetadata() {
  const t = await getTranslations('Console.dashboard')
  return { title: t('runtime_title') }
}

export default function Page() {
  return <RuntimeCard />
}
