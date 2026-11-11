import type { Metadata } from 'next'
import type { WebSite, WithContext } from 'schema-dts'
import type { BlogHomeInitialData } from './blog-home-query'
import { getLocale, getTranslations } from 'next-intl/server'
import { cacheLife, cacheTag } from 'next/cache'
import { Suspense } from 'react'
import { getCachedSiteInfo } from '@/api/misc.server'
import { listPosts } from '@/api/post'
import { PostList } from '@/components/blog-home/post-list'
import { BlogSidebarSkeleton } from '@/components/blog-sidebar/sidebar-skeleton'
import { SiteShell } from '@/components/layout/site-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { localeAlternates } from '@/i18n/alternates'
import { localizePath } from '@/i18n/routing'
import { CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { OrderBy } from '@/models/common'
import { safeMetadataBase } from '@/utils/common/siteinfo'
import BlogHome from './blog-home'
import { blogHomeQueryKey } from './blog-home-query'

export async function generateMetadata(): Promise<Metadata> {
  const siteInfo = await getCachedSiteInfo()
  const routeT = await getTranslations('Route')
  const locale = await getLocale()
  return {
    title: routeT('homepage'),
    description: siteInfo.metadata.description,
    metadataBase: safeMetadataBase(siteInfo?.baseUrl),
    // 没有配置站点图标时不输出 icon 链接，浏览器使用 /favicon.ico
    icons: siteInfo.metadata.icon ? [{ rel: 'icon', url: siteInfo.metadata.icon }] : undefined,
    keywords: siteInfo.keywords,
    openGraph: {
      title: `${routeT('homepage')} - ${siteInfo.metadata.name}`,
      description: siteInfo.metadata.description,
      url: localizePath('/', locale),
      siteName: siteInfo?.metadata.name || 'Site Name',
      images: [
        {
          url: siteInfo?.metadata.icon || '',
          width: 800,
          height: 600,
          alt: siteInfo?.metadata.name || 'Site Name',
        },
      ],
      // Open Graph 的 locale 写法为 language_TERRITORY，如 zh_TW
      locale: locale.replace('-', '_'),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${routeT('homepage')} - ${siteInfo.metadata.name}`,
      description: siteInfo.metadata.description,
      images: [siteInfo.metadata.icon || ''],
    },
    alternates: localeAlternates('/', locale),
  }
}

type HomeSearchParams = Record<string, string | string[] | undefined>

// 默认视图（第一页、不筛选、按最新）的文章列表跨请求缓存：首页最常见的就是它，文章、分类、标签变化时 posts 标签失效。
// 带筛选、翻页、搜索的组合来自地址栏，随手就能拼出无数个，照常每次向后端取
async function loadDefaultPosts(pageSize: number) {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Posts)
  return listPosts({ page: 1, orderBy: OrderBy.CreatedAt, size: pageSize, desc: true, withPinned: true }).then(res => res.data)
}

// 服务端预取首屏文章（默认按最新排序），客户端参数一致时直接复用；不带登录身份，只含公开文章
async function getInitialPosts(searchParams: HomeSearchParams, pageSize: number): Promise<BlogHomeInitialData | undefined> {
  const pick = (key: string) => (typeof searchParams[key] === 'string' ? searchParams[key] as string : undefined)
  const page = Math.max(1, Number.parseInt(pick('page') || '1', 10) || 1)
  const params = { page, label: pick('label'), category: pick('category'), query: pick('query'), orderBy: OrderBy.CreatedAt }
  const isDefault = page === 1 && !params.label && !params.category && !params.query
  skipBackendAtBuild()
  try {
    const size = pageSize || 9
    const data = isDefault
      ? await loadDefaultPosts(size)
      : await listPosts({ ...params, size, desc: true, withPinned: true }).then(res => res.data)
    return { key: blogHomeQueryKey(params), posts: data.posts, total: data.total, pinned: data.pinned ?? [] }
  }
  catch {
    return undefined // 预取失败时交给客户端加载
  }
}

// 读地址查询参数（分页、标签、搜索）的部分：放在 Suspense 里按请求渲染，外面的部分属于首页的 App Shell 与页面缓存
async function HomePosts({ searchParams }: { searchParams: Promise<HomeSearchParams> }) {
  const [query, siteInfo] = await Promise.all([searchParams, getCachedSiteInfo()])
  return <BlogHome initialData={await getInitialPosts(query, siteInfo.postsPerPage)} />
}

// 文章列表到达前的占位：与列表加载态相同的文章行，侧栏只画占位卡片
function HomeSkeleton() {
  return (
    <SiteShell
      skeleton
      sidebar={<BlogSidebarSkeleton />}
    >
      <div className="grid gap-1 px-4 md:px-2" aria-busy="true">
        <Skeleton className="h-7 w-48 md:h-8" />
      </div>
      <PostList posts={[]} isLoading />
    </SiteShell>
  )
}

export default async function Page({ searchParams }: { searchParams: Promise<HomeSearchParams> }) {
  const siteInfo = await getCachedSiteInfo()
  const jsonLd: WithContext<WebSite> = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': siteInfo.metadata.name,
    'url': siteInfo.baseUrl,
    'description': siteInfo.metadata.description,
    'publisher': {
      '@type': 'Organization',
      'name': siteInfo.metadata.name,
      'logo': {
        '@type': 'ImageObject',
        'url': siteInfo.metadata.icon,
      },
    },
    'potentialAction': {
      '@type': 'SearchAction',
      'target': `${siteInfo.baseUrl}/?query={search_term_string}`,
      'query': 'required name=search_term_string',
    },
  }
  return (
    <>
      <Suspense fallback={<HomeSkeleton />}>
        <HomePosts searchParams={searchParams} />
      </Suspense>
      {/* 结构化数据直接输出在 SSR 的 HTML 里，不依赖 JS 注入 */}
      <script
        id="json-ld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
    </>
  )
}
