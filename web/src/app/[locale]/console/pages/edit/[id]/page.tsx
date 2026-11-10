import { getTranslations } from 'next-intl/server'
import { PageEditor } from './page-editor'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('pages.title'),
  }
}

export default function Page() {
  return <PageEditor />
}
