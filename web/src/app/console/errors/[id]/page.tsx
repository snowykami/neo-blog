import { getTranslations } from 'next-intl/server'
import { ErrorIssueView } from '@/components/console/errors/issue-detail'

export async function generateMetadata() {
  const t = await getTranslations('Console.errors.detail')
  return { title: t('title') }
}

export default function Page() {
  return <ErrorIssueView />
}
