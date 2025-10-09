import { getTranslations } from 'next-intl/server'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('comments.title'),
  }
}

export default function Page() {
  return <div>评论管理</div>
}
