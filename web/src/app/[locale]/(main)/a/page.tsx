import type { Metadata } from 'next'
import type { ArchiveGroup } from './archive'
import type { Post } from '@/models/post'
import process from 'node:process'
import { getLocale, getTranslations } from 'next-intl/server'
import { cacheLife, cacheTag } from 'next/cache'
import { Suspense } from 'react'
import { listPosts } from '@/api/post'
import { getCachedSidebarData } from '@/components/blog-sidebar/sidebar-data'
import { BlogSidebarSkeleton } from '@/components/blog-sidebar/sidebar-skeleton'
import { SiteShell } from '@/components/layout/site-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { localeAlternates } from '@/i18n/alternates'
import { CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { OrderBy } from '@/models/common'
import { getPostUrl, mainPath } from '@/utils/common/route'
import { Archive } from './archive'

// 归档日期按站点时区计算，与后端容器的 TZ 保持一致；在服务端算好再传给客户端，避免水合时因时区不同而错位
const ARCHIVE_TIME_ZONE = process.env.TZ || 'Asia/Chongqing'

export async function generateMetadata(): Promise<Metadata> {
  const routeT = await getTranslations('Route')
  return { title: routeT('archive'), alternates: localeAlternates(mainPath.archive, await getLocale()) }
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
    group.posts.push({
      id: post.id,
      title: post.title,
      url: getPostUrl({ post }),
      date: monthDay,
      labels: (post.labels || []).map(label => label.name),
    })
  }
  return groups.sort((a, b) => b.year - a.year)
}

function fetchArchivePosts(label: string, category: string): Promise<Post[]> {
  return listPosts({ page: 1, size: 500, orderBy: OrderBy.CreatedAt, desc: true, noContent: true, label, category })
    .then(res => res.data.posts)
}

// 不筛选的归档（最常见）跨请求缓存，文章、分类、标签变化时 posts 标签失效；带 ?label= / ?category= 的组合来自地址栏，照常每次向后端取
async function loadAllPosts(): Promise<Post[]> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Posts)
  return fetchArchivePosts('', '')
}

// 读地址查询参数的部分：放在 Suspense 里按请求渲染，外面的部分属于归档页的 App Shell
async function ArchiveContent({ searchParams }: { searchParams: Promise<{ label?: string, category?: string }> }) {
  // 支持 ?label=xxx / ?category=xxx 只看某个标签或分类的归档
  const { label = '', category = '' } = await searchParams
  skipBackendAtBuild()
  const [posts, sidebarData] = await Promise.all([
    (label || category ? fetchArchivePosts(label, category) : loadAllPosts()).catch(() => []),
    getCachedSidebarData(),
  ])
  return <Archive groups={groupByYear(posts)} filter={{ label, category }} sidebarData={sidebarData} />
}

// 归档到达前的占位：时间线卡片里画几行
function ArchiveSkeleton() {
  return (
    <SiteShell skeleton sidebar={<BlogSidebarSkeleton />}>
      <div className="grid gap-4 rounded-2xl bg-card px-4 py-6 md:px-8" aria-busy="true">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-3/5" />
      </div>
    </SiteShell>
  )
}

export default function ArchivesPage({
  searchParams,
}: {
  searchParams: Promise<{ label?: string, category?: string }>
}) {
  return (
    <Suspense fallback={<ArchiveSkeleton />}>
      <ArchiveContent searchParams={searchParams} />
    </Suspense>
  )
}
