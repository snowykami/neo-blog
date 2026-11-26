import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { locale as rootLocale } from 'next/root-params'
import { getCachedSiteInfo } from '@/api/misc.server'
import { MusicPlayerPage } from '@/components/music-page/music-player-page'
import { MUSIC_PAGE_PATH } from '@/components/music-page/music-share-params'
import { resolveRouteLocale } from '@/i18n/routing'
import { buildPublicPageMetadata } from '@/lib/seo'

export const ensureStatic = 'navigation'

// 播放器页：沉浸式全屏，不使用站点顶栏与页脚（不在 (main) 路由组内）；播放状态来自根布局的全局 MusicProvider
export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveRouteLocale(await rootLocale())
  setRequestLocale(locale)
  const [siteInfo, routeT] = await Promise.all([
    getCachedSiteInfo(),
    getTranslations('Route'),
  ])
  const title = routeT('music')
  const description = routeT('music_desc', { site: siteInfo.metadata.name })
  return buildPublicPageMetadata({
    locale,
    pathname: MUSIC_PAGE_PATH,
    siteInfo,
    title,
    description,
    forceNoIndex: !siteInfo.musicEnabled,
  })
}

export default async function MusicPage() {
  const locale = resolveRouteLocale(await rootLocale())
  setRequestLocale(locale)
  const [siteInfo, routeT] = await Promise.all([
    getCachedSiteInfo(),
    getTranslations('Route'),
  ])
  return (
    <MusicPlayerPage
      seoHeading={`${routeT('music')} - ${siteInfo.metadata.name}`}
      seoDescription={routeT('music_desc', { site: siteInfo.metadata.name })}
    />
  )
}
