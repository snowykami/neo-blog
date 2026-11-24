import type { Metadata } from 'next'
import type { WebSite, WithContext } from 'schema-dts'
import type { BlogHomeInitialData } from './blog-home-query'
import type { OrderBy } from '@/models/common'
import type { Post } from '@/models/post'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { cacheLife, cacheTag } from 'next/cache'
import { locale as rootLocale } from 'next/root-params'
import { Suspense } from 'react'
import { getCachedSiteInfo } from '@/api/misc.server'
import { listPosts } from '@/api/post'
import { PostList } from '@/components/blog-home/post-list'
import BlogSidebar from '@/components/blog-sidebar'
import { getSidebarCards } from '@/components/blog-sidebar/sidebar-cards'
import { getCachedSidebarData } from '@/components/blog-sidebar/sidebar-data'
import { BlogSidebarSkeleton } from '@/components/blog-sidebar/sidebar-skeleton'
import { SiteShell } from '@/components/layout/site-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { localeAlternates } from '@/i18n/alternates'
import { localizePath, resolveRouteLocale } from '@/i18n/routing'
import { CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { absoluteSiteUrl, safeMetadataBase } from '@/utils/common/siteinfo'
import BlogHome from './blog-home'
import { blogHomeQueryKey, parseHomeTab } from './blog-home-query'

export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveRouteLocale(await rootLocale())
  setRequestLocale(locale)
  const [siteInfo, routeT] = await Promise.all([
    getCachedSiteInfo(),
    getTranslations('Route'),
  ])
  return {
    title: routeT('homepage'),
    description: siteInfo.metadata.description,
    metadataBase: safeMetadataBase(siteInfo?.baseUrl),
    keywords: siteInfo.keywords,
    openGraph: {
      title: `${routeT('homepage')} - ${siteInfo.metadata.name}`,
      description: siteInfo.metadata.description,
      url: localizePath('/', locale),
      siteName: siteInfo.metadata.name || undefined,
      images: [
        {
          url: siteInfo?.metadata.icon || '',
          width: 800,
          height: 600,
          alt: siteInfo.metadata.name,
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

// 默认视图（第一页、不筛选）的文章列表跨请求缓存：最新与热门各自成键，文章、分类、标签变化时 posts 标签失效。
// 带筛选、翻页、搜索的组合来自地址栏，随手就能拼出无数个，照常每次向后端取
async function loadDefaultPosts(pageSize: number, orderBy: OrderBy) {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Posts)
  return listPosts({ page: 1, orderBy, size: pageSize, desc: true, withPinned: true }).then(res => res.data)
}

// 列表只展示摘要（作者描述 → 后端纯文本摘要 → 正文兜底，见 post-list.tsx）：已经有描述或摘要时去掉截断的正文 HTML，
// 首屏数据在 HTML 与 RSC 里各出现一次，少带一份用不到的字段
function slimPost(post: Post): Post {
  return post.description || post.excerpt ? { ...post, content: '' } : post
}

// 服务端预取首屏文章（默认按最新排序），客户端参数一致时直接复用；不带登录身份，只含公开文章
async function getInitialPosts(searchParams: HomeSearchParams, pageSize: number): Promise<BlogHomeInitialData | undefined> {
  const pick = (key: string) => (typeof searchParams[key] === 'string' ? searchParams[key] as string : undefined)
  const page = Math.max(1, Number.parseInt(pick('page') || '1', 10) || 1)
  const params = {
    page,
    label: pick('label'),
    category: pick('category'),
    query: pick('query'),
    orderBy: parseHomeTab(pick('tab')),
  }
  const isDefault = page === 1 && !params.label && !params.category && !params.query
  skipBackendAtBuild()
  try {
    const size = pageSize || 9
    const data = isDefault
      ? await loadDefaultPosts(size, params.orderBy)
      : await listPosts({ ...params, size, desc: true, withPinned: true }).then(res => res.data)
    return { key: blogHomeQueryKey(params), posts: data.posts.map(slimPost), total: data.total, pinned: (data.pinned ?? []).map(slimPost) }
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

// 侧栏不读地址参数（标签云的选中状态在客户端读，见 BlogSidebar 的 labelFromQuery），数据跨请求缓存，属于首页的静态外壳：
// 首屏第一批 HTML 里就有侧栏，不再跟着文章列表一起等
async function HomeSidebar() {
  return <BlogSidebar labelFromQuery initialData={await getCachedSidebarData()} />
}

// 文章列表到达前的占位：高度与真实首屏（移动端站长名片条 + 44px 标题排序栏 + 每页条数）严格对齐，避免流式替换产生 CLS
function HomePostsSkeleton({ showOwnerBanner, postsPerPage }: { showOwnerBanner: boolean, postsPerPage?: number }) {
  return (
    <>
      {showOwnerBanner && (
        <div className="surface-card flex items-center gap-3 rounded-2xl bg-card p-3.5 lg:hidden" aria-hidden="true">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3.5 w-48 max-w-full" />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1.5 md:px-2" aria-busy="true">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-11 w-36 rounded-lg" />
      </div>
      <PostList posts={[]} isLoading skeletonCount={postsPerPage || 9} />
    </>
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
        // 站点图标存的是站内相对路径，结构化数据要求绝对地址
        'url': absoluteSiteUrl(siteInfo.metadata.icon, siteInfo.baseUrl),
      },
    },
    'potentialAction': {
      '@type': 'SearchAction',
      'target': `${siteInfo.baseUrl}/?query={search_term_string}`,
      'query': 'required name=search_term_string',
    },
  }
  const showOwnerBanner = Boolean(
    (siteInfo.owner?.name || siteInfo.metadata.name)
    && getSidebarCards(siteInfo).some(card => card.type === 'about'),
  )
  return (
    <>
      <SiteShell
        sidebar={(
          <Suspense fallback={<BlogSidebarSkeleton />}>
            <HomeSidebar />
          </Suspense>
        )}
      >
        <Suspense fallback={<HomePostsSkeleton showOwnerBanner={showOwnerBanner} postsPerPage={siteInfo.postsPerPage} />}>
          <HomePosts searchParams={searchParams} />
        </Suspense>
      </SiteShell>
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
