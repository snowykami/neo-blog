import { getTranslations } from 'next-intl/server'
import { VisitDetailView } from '@/components/console/visits/visit-detail'

// 后台按请求渲染，不做即时导航校验（见 app/[locale]/console/layout.tsx）
export const instant = false

export async function generateMetadata() {
  const t = await getTranslations('Console.visits.detail')
  return { title: t('title') }
}

export default function Page() {
  return <VisitDetailView />
}
