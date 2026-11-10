import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { listPosts } from '@/api/post'
import { PostList } from '@/components/blog-home/post-list'
import BlogSidebar from '@/components/blog-sidebar'
import { SectionTitle, SiteShell } from '@/components/layout/site-shell'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { localeAlternates } from '@/i18n/alternates'
import { localizePath } from '@/i18n/routing'
import { OrderBy } from '@/models/common'
import { getCategoryUrl } from '@/utils/common/route'
import { findCategoryOr404 } from './category-data'

const PAGE_SIZE = 20

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  // 与 layout、页面共用同一次请求；不存在的分类已在 layout 判定 404（见 layout.tsx）
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
  const { slug } = await params
  const { page: pageParam } = await searchParams
  const page = Math.max(1, Number.parseInt(pageParam || '1', 10) || 1)
  const archiveT = await getTranslations('Archive')
  const operationT = await getTranslations('Operation')
  const locale = await getLocale()

  const category = await findCategoryOr404(slug)

  const { posts, total } = await listPosts({
    page,
    size: PAGE_SIZE,
    category: slug,
    orderBy: OrderBy.CreatedAt,
    desc: true,
  }).then(res => ({ posts: res.data.posts || [], total: res.data.total || 0 })).catch(() => ({ posts: [], total: 0 }))

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const baseUrl = category ? getCategoryUrl(category) : `/c/${encodeURIComponent(slug)}`
  // 分页是普通 <a>，自己带上语言前缀
  const pageUrl = (p: number) => localizePath(p <= 1 ? baseUrl : `${baseUrl}?page=${p}`, locale)

  return (
    <SiteShell
      sidebar={(
        <BlogSidebar />
      )}
    >
      <div className="grid gap-1 px-4 md:px-2">
        <SectionTitle as="h1" className="text-xl md:text-2xl">
          {archiveT('filter_category', { name: category?.name || slug })}
          {total > 0 && <span className="ml-2 text-base font-medium text-foreground/50 tabular-nums">{total}</span>}
        </SectionTitle>
        {category?.description && <p className="pl-4 text-sm text-foreground/50">{category.description}</p>}
      </div>
      <PostList posts={posts} />
      {totalPages > 1 && (
        <Pagination className="pt-2">
          <PaginationContent>
            {page > 1 && (
              <PaginationItem>
                <PaginationPrevious href={pageUrl(page - 1)} aria-label={operationT('previous')} />
              </PaginationItem>
            )}
            <PaginationItem>
              <span className="px-3 text-sm text-foreground/50 tabular-nums">
                {page}
                {' / '}
                {totalPages}
              </span>
            </PaginationItem>
            {page < totalPages && (
              <PaginationItem>
                <PaginationNext href={pageUrl(page + 1)} aria-label={operationT('next')} />
              </PaginationItem>
            )}
          </PaginationContent>
        </Pagination>
      )}
    </SiteShell>
  )
}
