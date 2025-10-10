import { getTranslations } from 'next-intl/server'
import { FileManage } from './file-manage'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('files.title'),
  }
}

export default function Page() {
  return <FileManage />
}
