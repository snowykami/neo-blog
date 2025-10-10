import { getTranslations } from 'next-intl/server'
import { CategoryManage } from './category-manage'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('categories.title'),
  }
}

export default function Page() {
  return <CategoryManage />
}
