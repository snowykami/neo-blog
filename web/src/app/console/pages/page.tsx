import { getTranslations } from 'next-intl/server'
import { PageManage } from './page-manage'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('pages.title'),
  }
}

export default function Page() {
  return <PageManage />
}
