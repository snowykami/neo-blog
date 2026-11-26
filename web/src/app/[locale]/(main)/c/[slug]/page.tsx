import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getCachedSiteInfo } from '@/api/misc.server'
import BlogSidebar from '@/components/blog-sidebar'
import { getCachedSidebarData } from '@/components/blog-sidebar/sidebar-data'
import { SectionTitle, SiteShell } from '@/components/layout/site-shell'
import { resolveRouteLocale } from '@/i18n/routing'
import { BUILD_PLACEHOLDER_PARAM } from '@/lib/cache-tags'
import { buildPublicPageMetadata } from '@/lib/seo'
import { getCategoryUrl } from '@/utils/common/route'
import { CATEGORY_PAGE_SIZE, findCategoryOr404, listCategoryPosts } from './category-data'
import { CategoryPostsClient } from './category-posts.client'

export const ensureStatic = 'navigation'
export const instant = false

// 分类页按地址缓存（每个分类、每种语言一份）：构建时只预渲染占位参数（见 lib/cache-tags.ts 的 BUILD_PLACEHOLDER_PARAM），
// 首屏第一页随跨请求缓存直接输出到 <main>，?page=2+ 由客户端无感接管
export function generateStaticParams() {
  return [{ slug: BUILD_PLACEHOLDER_PARAM }]
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string, slug: string }> }): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params
  const locale = resolveRouteLocale(rawLocale)
  setRequestLocale(locale)
  // 与页面共用同一次分类列表读取；不存在的分类判定 404
  const [category, siteInfo, archiveT, routeT] = await Promise.all([
    findCategoryOr404(slug),
    getCachedSiteInfo(),
    getTranslations('Archive'),
    getTranslations('Route'),
  ])
  const title = archiveT('filter_category', { name: category?.name || slug })
  const description = category?.description?.trim() || routeT('category_desc', { site: siteInfo.metadata.name })
  const pathname = category ? getCategoryUrl(category) : `/c/${encodeURIComponent(slug)}`
  return buildPublicPageMetadata({
    locale,
    pathname,
    siteInfo,
    title,
    description,
  })
}

export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{ locale: string, slug: string }>
}) {
  const { locale: rawLocale, slug } = await params
  const locale = resolveRouteLocale(rawLocale)
  setRequestLocale(locale)
  const category = await findCategoryOr404(slug)
  const [sidebarData, archiveT, firstPage] = await Promise.all([
    getCachedSidebarData(),
    getTranslations('Archive'),
    listCategoryPosts(slug, 1),
  ])
  const baseUrl = category ? getCategoryUrl(category) : `/c/${encodeURIComponent(slug)}`

  return (
    <SiteShell
      sidebar={(
        <BlogSidebar initialData={sidebarData} />
      )}
    >
      <div className="grid gap-1 px-4 md:px-2">
        <SectionTitle as="h1" className="text-xl md:text-2xl">
          {archiveT('filter_category', { name: category?.name || slug })}
          {firstPage.total > 0 && (
            <span className="ml-2 text-base font-medium text-muted-foreground tabular-nums">{firstPage.total}</span>
          )}
        </SectionTitle>
        {category?.description && <p className="pl-4 text-sm text-muted-foreground">{category.description}</p>}
      </div>
      <CategoryPostsClient
        slug={slug}
        baseUrl={baseUrl}
        pageSize={CATEGORY_PAGE_SIZE}
        initialPosts={firstPage.posts}
        initialTotal={firstPage.total}
      />
    </SiteShell>
  )
}
