import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { locale as rootLocale } from 'next/root-params'
import { resolveRouteLocale } from '@/i18n/routing'
import { RandomPost } from './random-post'

export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveRouteLocale(await rootLocale())
  setRequestLocale(locale)
  const t = await getTranslations('Random')
  // 跳转中转页，不需要被收录
  return { title: t('title'), robots: { index: false, follow: true } }
}

export default function RandomPostPage() {
  return <RandomPost />
}
