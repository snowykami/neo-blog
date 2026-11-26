import type { Metadata } from 'next'
import type { ArchiveGroup } from './archive'
import type { Post } from '@/models/post'
import process from 'node:process'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { cacheLife, cacheTag } from 'next/cache'
import { locale as rootLocale } from 'next/root-params'
import { getCachedSiteInfo } from '@/api/misc.server'
import { listPosts } from '@/api/post'
import { getCachedSidebarData } from '@/components/blog-sidebar/sidebar-data'
import { resolveRouteLocale } from '@/i18n/routing'
import { CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { buildPublicPageMetadata } from '@/lib/seo'
import { OrderBy } from '@/models/common'
import { getPostUrl, mainPath } from '@/utils/common/route'
import { Archive } from './archive'

export const ensureStatic = 'navigation'

// 归档日期按站点时区计算，与后端容器的 TZ 保持一致；在服务端算好再传给客户端，避免水合时因时区不同而错位
const ARCHIVE_TIME_ZONE = process.env.TZ || 'Asia/Chongqing'

export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveRouteLocale(await rootLocale())
  setRequestLocale(locale)
  const [siteInfo, routeT] = await Promise.all([
    getCachedSiteInfo(),
    getTranslations('Route'),
  ])
  return buildPublicPageMetadata({
    locale,
    pathname: mainPath.archive,
    siteInfo,
    title: routeT('archive'),
    description: routeT('archive_desc', { site: siteInfo.metadata.name }),
  })
}

function getDateParts(date: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ARCHIVE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(date))
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return { year: Number(get('year')), monthDay: `${get('month')}-${get('day')}` }
}

// 按年份分组，年份倒序，组内保持接口返回的时间倒序
function groupByYear(posts: Post[]): ArchiveGroup[] {
  const groups: ArchiveGroup[] = []
  for (const post of posts) {
    const { year, monthDay } = getDateParts(post.createdAt)
    let group = groups.find(item => item.year === year)
    if (!group) {
      group = { year, posts: [] }
      groups.push(group)
    }
    const labels = post.labels || []
    group.posts.push({
      id: post.id,
      title: post.title,
      url: getPostUrl({ post }),
      date: monthDay,
      labels: labels.map(label => label.name),
      labelSlugs: labels.map(label => label.slug),
      categorySlug: post.category?.slug || undefined,
      categoryName: post.category?.name || undefined,
    })
  }
  return groups.sort((a, b) => b.year - a.year)
}

// 全量归档文章列表跨请求缓存，文章、分类、标签变化时 posts 标签失效；?label= / ?category= 在客户端无延迟过滤
async function loadAllPosts(): Promise<Post[]> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Posts)
  return listPosts({ page: 1, size: 500, orderBy: OrderBy.CreatedAt, desc: true, noContent: true })
    .then(res => res.data.posts)
}

export default async function ArchivesPage() {
  const locale = resolveRouteLocale(await rootLocale())
  setRequestLocale(locale)
  skipBackendAtBuild()
  const [posts, sidebarData] = await Promise.all([
    loadAllPosts(),
    getCachedSidebarData(),
  ])
  return <Archive groups={groupByYear(posts)} sidebarData={sidebarData} />
}
