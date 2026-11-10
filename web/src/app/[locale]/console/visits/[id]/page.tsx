import { getTranslations } from 'next-intl/server'
import { VisitDetailView } from '@/components/console/visits/visit-detail'

export async function generateMetadata() {
  const t = await getTranslations('Console.visits.detail')
  return { title: t('title') }
}

export default function Page() {
  return <VisitDetailView />
}
