import { getTranslations } from 'next-intl/server'
import { PageManage } from './page-manage'

// 后台按请求渲染，不做即时导航校验（见 app/[locale]/console/layout.tsx）
export const instant = false

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('pages.title'),
  }
}

export default function Page() {
  return <PageManage />
}
