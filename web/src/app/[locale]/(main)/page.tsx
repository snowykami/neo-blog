import type { Metadata } from 'next'
import type { WebSite, WithContext } from 'schema-dts'
import type { BlogHomeInitialData } from './blog-home-query'
import type { Post } from '@/models/post'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { cacheLife, cacheTag } from 'next/cache'
import { locale as rootLocale } from 'next/root-params'
import { getCachedSiteInfo } from '@/api/misc.server'
import { listPosts } from '@/api/post'
import BlogSidebar from '@/components/blog-sidebar'
import { getCachedSidebarData } from '@/components/blog-sidebar/sidebar-data'
import { SiteShell } from '@/components/layout/site-shell'
import { resolveRouteLocale } from '@/i18n/routing'
import { CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { buildPublicPageMetadata, resolveHomeSeoDescription, resolveHomeSeoTitle } from '@/lib/seo'
import { OrderBy } from '@/models/common'
import { absoluteSiteUrl } from '@/utils/common/siteinfo'
import BlogHome from './blog-home'
import { blogHomeQueryKey } from './blog-home-query'

export const ensureStatic = 'navigation'

export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveRouteLocale(await rootLocale())
  setRequestLocale(locale)
  const [siteInfo, routeT] = await Promise.all([
    getCachedSiteInfo(),
    getTranslations('Route'),
  ])
  const homeTitle = resolveHomeSeoTitle(siteInfo)
  const homeDescription = resolveHomeSeoDescription(
    siteInfo,
    routeT('home_desc', { site: siteInfo.metadata.name || 'Blog' }),
  )
  return buildPublicPageMetadata({
    locale,
    pathname: '/',
    siteInfo,
    title: { absolute: homeTitle },
    socialTitle: homeTitle,
    description: homeDescription,
    richRobots: true,
  })
}

// 默认视图（第一页、不筛选）的文章列表跨请求缓存：最新与热门各自成键，文章、分类、标签变化时 posts 标签失效。
// 带筛选、翻页、搜索的组合由客户端地址参数接管（见 BlogHomeQueryBridge），避免阻塞首页完整静态 HTML 直出
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

export default async function Page() {
  const locale = resolveRouteLocale(await rootLocale())
  setRequestLocale(locale)
  skipBackendAtBuild()
  const siteInfo = await getCachedSiteInfo()
  const pageSize = siteInfo.postsPerPage || 9
  const [sidebarData, defaultData, routeT] = await Promise.all([
    getCachedSidebarData(),
    loadDefaultPosts(pageSize, OrderBy.CreatedAt),
    getTranslations('Route'),
  ])
  const initialData: BlogHomeInitialData = {
    key: blogHomeQueryKey({ page: 1, orderBy: OrderBy.CreatedAt }),
    posts: defaultData.posts.map(slimPost),
    total: defaultData.total,
    pinned: (defaultData.pinned ?? []).map(slimPost),
  }
  const description = resolveHomeSeoDescription(
    siteInfo,
    routeT('home_desc', { site: siteInfo.metadata.name || 'Blog' }),
  ) || siteInfo.metadata.description
  const baseSiteUrl = (siteInfo.baseUrl ?? '').replace(/\/+$/, '')
  const jsonLd: WithContext<WebSite> = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': siteInfo.metadata.name,
    'url': baseSiteUrl || '/',
    'description': description,
    'publisher': {
      '@type': 'Organization',
      'name': siteInfo.metadata.name,
      'logo': {
        '@type': 'ImageObject',
        // 站点图标存的是站内相对路径，结构化数据要求绝对地址
        'url': absoluteSiteUrl(siteInfo.metadata.icon || '/favicon.ico', baseSiteUrl),
      },
    },
    'potentialAction': {
      '@type': 'SearchAction',
      'target': `${baseSiteUrl}/?query={search_term_string}`,
      'query': 'required name=search_term_string',
    },
  }
  return (
    <>
      <SiteShell
        sidebar={<BlogSidebar labelFromQuery initialData={sidebarData} />}
      >
        <BlogHome initialData={initialData} />
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
