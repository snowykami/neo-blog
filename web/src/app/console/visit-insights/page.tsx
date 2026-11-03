import { getTranslations } from 'next-intl/server'
import { VisitInsightsView } from '@/components/console/visits/visit-insights'

export async function generateMetadata() {
  const t = await getTranslations('Console.visit_insights')
  return { title: t('title') }
}

export default function Page() {
  return <VisitInsightsView />
}
