import { getTranslations } from 'next-intl/server'
import { StorageProviderManage } from '@/components/console/storages'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('storages.title'),
  }
}

export default function Page() {
  return (
    <StorageProviderManage />
  )
}
