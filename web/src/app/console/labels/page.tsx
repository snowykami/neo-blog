import { getTranslations } from 'next-intl/server'
import { LabelManage } from '@/components/console/label-manage'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('labels.title'),
  }
}

export default function Page() {
  return <LabelManage />
}
