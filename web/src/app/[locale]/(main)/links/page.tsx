import type { Metadata } from 'next'
import type { PublicFriendsData } from '@/models/friend'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { cacheLife, cacheTag } from 'next/cache'
import { locale as rootLocale } from 'next/root-params'
import { getPublicFriends } from '@/api/friend'
import { getCachedSiteInfo } from '@/api/misc.server'
import { SiteShell } from '@/components/layout/site-shell'
import { resolveRouteLocale } from '@/i18n/routing'
import { CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { buildPublicPageMetadata } from '@/lib/seo'
import { mainPath } from '@/utils/common/route'
import { FriendsDirectory } from './friends-directory'

export const ensureStatic = 'navigation'

export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveRouteLocale(await rootLocale())
  setRequestLocale(locale)
  const [siteInfo, routeT] = await Promise.all([
    getCachedSiteInfo(),
    getTranslations('Route'),
  ])
  return buildPublicPageMetadata({
    locale,
    pathname: mainPath.friends,
    siteInfo,
    title: routeT('friends'),
    description: routeT('friends_desc', { site: siteInfo.metadata.name }),
  })
}

const EMPTY_PUBLIC_FRIENDS: PublicFriendsData = {
  groups: [],
  siteInfo: {
    name: '',
    url: '',
    avatar: '',
    description: '',
  },
}

// 公开友链列表跨请求缓存：后台审核、增删改友链或分组时 friends 标签失效，修改站点信息时 site 标签失效
async function loadPublicFriends(): Promise<PublicFriendsData> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Friends, CacheTag.Site)
  return getPublicFriends().then(res => res.data ?? EMPTY_PUBLIC_FRIENDS)
}

export default async function FriendsPage() {
  const locale = resolveRouteLocale(await rootLocale())
  setRequestLocale(locale)
  skipBackendAtBuild()
  const initialData = await loadPublicFriends()
  return (
    <SiteShell>
      <FriendsDirectory initialData={initialData} />
    </SiteShell>
  )
}
