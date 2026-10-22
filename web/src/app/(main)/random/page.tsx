import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { RandomPost } from './random-post'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Random')
  // 跳转中转页，不需要被收录
  return { title: t('title'), robots: { index: false, follow: true } }
}

export default function RandomPostPage() {
  return <RandomPost />
}
