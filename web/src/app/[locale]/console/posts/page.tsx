import { getTranslations } from 'next-intl/server'
import { PostManage } from './post-manage'

export async function generateMetadata() {
  const consoleT = await getTranslations('Console')
  return {
    title: consoleT('posts.title'),
  }
}

export default function Page() {
  return <PostManage />
}
