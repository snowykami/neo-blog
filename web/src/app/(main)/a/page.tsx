import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Archive } from './archive'

export async function generateMetadata(): Promise<Metadata> {
  const routeT = await getTranslations('Route')
  return { title: routeT('archive') }
}

export default function ArchivesPage() {
  return (
    <Archive />
  )
}
