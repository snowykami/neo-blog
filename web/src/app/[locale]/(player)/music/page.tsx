import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { locale as rootLocale } from 'next/root-params'
import { MusicPlayerPage } from '@/components/music-page/music-player-page'
import { MUSIC_PAGE_PATH } from '@/components/music-page/music-share-params'
import { localeAlternates } from '@/i18n/alternates'
import { resolveRouteLocale } from '@/i18n/routing'

// 播放器页：沉浸式全屏，不使用站点顶栏与页脚（不在 (main) 路由组内）；播放状态来自根布局的全局 MusicProvider
export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveRouteLocale(await rootLocale())
  setRequestLocale(locale)
  const routeT = await getTranslations('Route')
  return { title: routeT('music'), alternates: localeAlternates(MUSIC_PAGE_PATH, locale) }
}

export default function MusicPage() {
  return <MusicPlayerPage />
}
