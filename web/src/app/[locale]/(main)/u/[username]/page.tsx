import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getCachedSiteInfo } from '@/api/misc.server'
import { resolveRouteLocale } from '@/i18n/routing'
import { BUILD_PLACEHOLDER_PARAM } from '@/lib/cache-tags'
import { buildPublicPageMetadata } from '@/lib/seo'
import { Role } from '@/models/user'
import { getUserUrl } from '@/utils/common/route'
import { formatDisplayName } from '@/utils/common/username'
import { UserPage } from './user'
import { getCachedUserFirstPagePosts, getExistingUser } from './user-data'

export const ensureStatic = 'navigation'
export const instant = false

// 用户页按地址缓存：构建时只预渲染占位参数（见 lib/cache-tags.ts 的 BUILD_PLACEHOLDER_PARAM），每个用户（每种语言）在第一次被访问时生成；
// 服务端同时预取公开资料与首屏第一页公开文章直接输出到 <main>，评论与喜欢按需在浏览器加载
export function generateStaticParams() {
  return [{ username: BUILD_PLACEHOLDER_PARAM }]
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string, username: string }>
}): Promise<Metadata> {
  const { locale: rawLocale, username } = await params
  const locale = resolveRouteLocale(rawLocale)
  setRequestLocale(locale)
  const [user, siteInfo, routeT] = await Promise.all([
    getExistingUser(username),
    getCachedSiteInfo(),
    getTranslations('Route'),
  ])
  const displayName = formatDisplayName(user)
  const ownerBio = user.role === Role.ADMIN
    ? (siteInfo.owner?.description?.trim() || siteInfo.owner?.motto?.trim() || '')
    : ''
  const description = ownerBio || routeT('user_desc', { name: displayName, site: siteInfo.metadata.name })
  return buildPublicPageMetadata({
    locale,
    pathname: getUserUrl(user),
    siteInfo,
    title: displayName,
    description,
    image: user.avatarUrl || undefined,
    ogType: 'profile',
  })
}

export default async function Page({ params }: { params: Promise<{ locale: string, username: string }> }) {
  const { locale: rawLocale, username } = await params
  const locale = resolveRouteLocale(rawLocale)
  setRequestLocale(locale)
  const [user, siteInfo] = await Promise.all([
    getExistingUser(username),
    getCachedSiteInfo(),
  ])
  const initialPosts = await getCachedUserFirstPagePosts(user.id, siteInfo.postsPerPage || 10)
  return <UserPage user={user} initialPosts={initialPosts} />
}
