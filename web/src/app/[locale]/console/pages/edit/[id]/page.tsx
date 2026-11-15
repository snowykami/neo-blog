import { getTranslations } from 'next-intl/server'
import { getPageForEditServer } from '@/api/page.server'
import { PageEditor } from './page-editor'

// 后台按请求渲染，不做即时导航校验（见 app/[locale]/console/layout.tsx）
export const instant = false

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('pages.title'),
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const initialPage = await getPageForEditServer({ id })
    .then(r => r.data)
    .catch(() => null)
  return <PageEditor initialPage={initialPage} />
}
