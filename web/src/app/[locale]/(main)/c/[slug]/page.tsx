import type { Metadata } from 'next'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { PostList } from '@/components/blog-home/post-list'
import BlogSidebar from '@/components/blog-sidebar'
import { SectionTitle, SiteShell } from '@/components/layout/site-shell'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination'
import { localeAlternates } from '@/i18n/alternates'
import { Link } from '@/i18n/navigation'
import { BUILD_PLACEHOLDER_PARAM } from '@/lib/cache-tags'
import { getCategoryUrl } from '@/utils/common/route'
import { CATEGORY_PAGE_SIZE, findCategoryOr404, listCategoryPosts } from './category-data'

// 分类页按地址缓存（每个分类、每种语言一份）：构建时只预渲染占位参数（见 lib/cache-tags.ts 的 BUILD_PLACEHOLDER_PARAM），
// 第一次被访问时生成；读 ?page= 的文章列表在页面缓存里留成 Suspense 骨架，按请求补上（第一页取自取数缓存，见 category-data.ts）
export function generateStaticParams() {
  return [{ slug: BUILD_PLACEHOLDER_PARAM }]
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  // 与页面共用同一次分类列表读取；不存在的分类由页面判定 404
  const category = await findCategoryOr404(slug)
  const archiveT = await getTranslations('Archive')
  return {
    title: archiveT('filter_category', { name: category?.name || slug }),
    description: category?.description || undefined,
    alternates: category ? localeAlternates(getCategoryUrl(category), await getLocale()) : undefined,
  }
}

export default async function CategoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}) {
  // 地址参数只在页面里读（loading.tsx 的骨架里面）：layout 与骨架属于所有分类页共用的 App Shell。
  // 先判定分类是否存在、再读 ?page=：不存在时生成页面的过程中就 404，状态码才是真正的 404
  const { slug } = await params
  const category = await findCategoryOr404(slug)
  const archiveT = await getTranslations('Archive')

  return (
    <SiteShell
      sidebar={(
        <BlogSidebar />
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
        <CategoryPosts slug={slug} baseUrl={category ? getCategoryUrl(category) : `/c/${encodeURIComponent(slug)}`} searchParams={searchParams} />
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

// 读 ?page= 的部分：按请求渲染，第一页取自取数缓存
async function CategoryPosts({ slug, baseUrl, searchParams }: { slug: string, baseUrl: string, searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams
  const page = readPage(pageParam)
  const operationT = await getTranslations('Operation')
  const { posts, total } = await listCategoryPosts(slug, page).catch(() => ({ posts: [], total: 0 }))

  const totalPages = Math.max(1, Math.ceil(total / CATEGORY_PAGE_SIZE))
  // 翻页用站内 Link（自动带语言前缀）：客户端跳转，不整页刷新、音乐不中断；预取沿用默认（进入视口取外壳、悬停取整页）
  const pageUrl = (p: number) => (p <= 1 ? baseUrl : `${baseUrl}?page=${p}`)

  return (
    <>
      <PostList posts={posts} />
      {totalPages > 1 && (
        <Pagination className="pt-2">
          <PaginationContent>
            {page > 1 && (
              <PaginationItem>
                <PaginationLink asChild size="default" className="px-2.5">
                  <Link href={pageUrl(page - 1)} aria-label={operationT('previous')}>
                    <ChevronLeftIcon aria-hidden />
                  </Link>
                </PaginationLink>
              </PaginationItem>
            )}
            <PaginationItem>
              <span className="px-3 text-sm text-muted-foreground tabular-nums">
                {page}
                {' / '}
                {totalPages}
              </span>
            </PaginationItem>
            {page < totalPages && (
              <PaginationItem>
                <PaginationLink asChild size="default" className="px-2.5">
                  <Link href={pageUrl(page + 1)} aria-label={operationT('next')}>
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
