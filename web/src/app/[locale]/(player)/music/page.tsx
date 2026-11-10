import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { MusicPlayerPage } from '@/components/music-page/music-player-page'
import { MUSIC_PAGE_PATH } from '@/components/music-page/music-share-params'
import { localeAlternates } from '@/i18n/alternates'

// 播放器页：沉浸式全屏，不使用站点顶栏与页脚（不在 (main) 路由组内）；播放状态来自根布局的全局 MusicProvider
export async function generateMetadata(): Promise<Metadata> {
  const routeT = await getTranslations('Route')
  return { title: routeT('music'), alternates: localeAlternates(MUSIC_PAGE_PATH, await getLocale()) }
}

export default function MusicPage() {
  return <MusicPlayerPage />
}
