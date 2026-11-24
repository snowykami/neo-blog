import type { Metadata } from 'next'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Suspense } from 'react'
import { PostList } from '@/components/blog-home/post-list'
import BlogSidebar from '@/components/blog-sidebar'
import { getCachedSidebarData } from '@/components/blog-sidebar/sidebar-data'
import { SectionTitle, SiteShell } from '@/components/layout/site-shell'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination'
import { localeAlternates } from '@/i18n/alternates'
import { Link } from '@/i18n/navigation'
import { resolveRouteLocale } from '@/i18n/routing'
import { BUILD_PLACEHOLDER_PARAM } from '@/lib/cache-tags'
import { getCategoryUrl } from '@/utils/common/route'
import { CATEGORY_PAGE_SIZE, findCategoryOr404, listCategoryPosts } from './category-data'

// 分类页按地址缓存（每个分类、每种语言一份）：构建时只预渲染占位参数（见 lib/cache-tags.ts 的 BUILD_PLACEHOLDER_PARAM），
// 第一次被访问时生成；段级骨架由同目录 loading.tsx 提供，读 ?page= 的部分包在内部 Suspense 里按请求流式补上
export function generateStaticParams() {
  return [{ slug: BUILD_PLACEHOLDER_PARAM }]
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string, slug: string }> }): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params
  const locale = resolveRouteLocale(rawLocale)
  setRequestLocale(locale)
  // 与页面共用同一次分类列表读取；不存在的分类判定 404
  const [category, archiveT] = await Promise.all([
    findCategoryOr404(slug),
    getTranslations('Archive'),
  ])
  return {
    title: archiveT('filter_category', { name: category?.name || slug }),
    description: category?.description || undefined,
    alternates: category ? localeAlternates(getCategoryUrl(category), locale) : undefined,
  }
}

export default async function CategoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string, slug: string }>
  searchParams: Promise<{ page?: string }>
}) {
  // 段级骨架由同目录 loading.tsx 提供（属于所有分类页共用的 App Shell）；
  // 先判定分类是否存在、再在内部 Suspense 读 ?page=：不存在时生成页面的过程中就 404，状态码才是真正的 404
  const { locale: rawLocale, slug } = await params
  const locale = resolveRouteLocale(rawLocale)
  setRequestLocale(locale)
  const [category, sidebarData, archiveT] = await Promise.all([
    findCategoryOr404(slug),
    getCachedSidebarData(),
    getTranslations('Archive'),
  ])

  return (
    <SiteShell
      sidebar={(
        <BlogSidebar initialData={sidebarData} />
      )}
    >
      <div className="grid gap-1 px-4 md:px-2">
        <SectionTitle as="h1" className="text-xl md:text-2xl">
          {archiveT('filter_category', { name: category?.name || slug })}
          <Suspense fallback={null}>
            <CategoryTotal slug={slug} searchParams={searchParams} />
          </Suspense>
        </SectionTitle>
        {category?.description && <p className="pl-4 text-sm text-muted-foreground">{category.description}</p>}
      </div>
      <Suspense fallback={<PostList posts={[]} isLoading />}>
        <CategoryPosts locale={locale} slug={slug} baseUrl={category ? getCategoryUrl(category) : `/c/${encodeURIComponent(slug)}`} searchParams={searchParams} />
      </Suspense>
    </SiteShell>
  )
}

function readPage(pageParam: string | undefined) {
  return Math.max(1, Number.parseInt(pageParam || '1', 10) || 1)
}

// 标题后的篇数：与列表共用同一次读取
async function CategoryTotal({ slug, searchParams }: { slug: string, searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams
  const { total } = await listCategoryPosts(slug, readPage(page)).catch(() => ({ total: 0 }))
  return total > 0 ? <span className="ml-2 text-base font-medium text-muted-foreground tabular-nums">{total}</span> : null
}

function buildPageItems(currentPage: number, totalPages: number): (number | 'ellipsis-start' | 'ellipsis-end')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }
  const windowSize = 3
  let start = currentPage - 1
  let end = currentPage + 1
  if (start < 3) {
    start = 3
    end = start + windowSize - 1
  }
  if (end > totalPages - 2) {
    end = totalPages - 2
    start = end - windowSize + 1
  }
  const items: (number | 'ellipsis-start' | 'ellipsis-end')[] = [1]
  items.push(start > 3 ? 'ellipsis-start' : 2)
  for (let p = start; p <= end; p++) items.push(p)
  items.push(end < totalPages - 2 ? 'ellipsis-end' : totalPages - 1)
  items.push(totalPages)
  return items
}

// 读 ?page= 的部分：按请求渲染，第一页取自取数缓存
async function CategoryPosts({ locale, slug, baseUrl, searchParams }: { locale: string, slug: string, baseUrl: string, searchParams: Promise<{ page?: string }> }) {
  setRequestLocale(locale)
  const { page: pageParam } = await searchParams
  const rawPage = readPage(pageParam)
  const [paginationT, { posts, total }] = await Promise.all([
    getTranslations('Components.pagination'),
    listCategoryPosts(slug, rawPage).catch(() => ({ posts: [], total: 0 })),
  ])

  const totalPages = Math.max(1, Math.ceil(total / CATEGORY_PAGE_SIZE))
  const currentPage = Math.min(rawPage, totalPages)
  const pageItems = buildPageItems(currentPage, totalPages)
  // 翻页用站内 Link（自动带语言前缀）：客户端跳转，不整页刷新、音乐不中断；预取沿用默认（进入视口取外壳、悬停取整页）
  const pageUrl = (p: number) => (p <= 1 ? baseUrl : `${baseUrl}?page=${p}`)

  return (
    <>
      <PostList posts={posts} prioritizeFirst />
      {totalPages > 1 && (
        <Pagination className="pt-2">
          <PaginationContent className="select-none gap-1.5 md:gap-1">
            {currentPage > 1 && (
              <PaginationItem>
                <PaginationLink asChild size="default" className="px-2.5">
                  <Link href={pageUrl(currentPage - 1)} aria-label={paginationT('previous_page')}>
                    <ChevronLeftIcon aria-hidden />
                  </Link>
                </PaginationLink>
              </PaginationItem>
            )}
            {pageItems.map(item => (
              typeof item === 'number'
                ? (
                    <PaginationItem key={item}>
                      <PaginationLink asChild isActive={item === currentPage}>
                        <Link href={pageUrl(item)} aria-label={paginationT('go_to_page', { page: item })}>
                          {item}
                        </Link>
                      </PaginationLink>
                    </PaginationItem>
                  )
                : (
                    <PaginationItem key={item}>
                      <PaginationEllipsis aria-hidden />
                    </PaginationItem>
                  )
            ))}
            {currentPage < totalPages && (
              <PaginationItem>
                <PaginationLink asChild size="default" className="px-2.5">
                  <Link href={pageUrl(currentPage + 1)} aria-label={paginationT('next_page')}>
                    <ChevronRightIcon aria-hidden />
                  </Link>
                </PaginationLink>
              </PaginationItem>
            )}
          </PaginationContent>
        </Pagination>
      )}
    </>
  )
}
