import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getCategories, listPosts } from '@/api/post'
import { PostList } from '@/components/blog-home/post-list'
import BlogSidebar from '@/components/blog-sidebar'
import { BlogSidebarAbout, BlogSidebarHotPosts, BlogSidebarLabels } from '@/components/blog-sidebar/blog-sidebar-card'
import { SectionTitle, SiteShell } from '@/components/layout/site-shell'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { OrderBy } from '@/models/common'
import { getCategoryUrl } from '@/utils/common/route'

const PAGE_SIZE = 20

// 没有按 slug 查询分类的接口，从分类列表中查找；metadata 与页面共享同一次请求
const getCachedCategories = cache(async () => {
  return getCategories().then(res => res.data.categories).catch(() => null)
})

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const category = (await getCachedCategories())?.find(c => c.slug === slug)
  const archiveT = await getTranslations('Archive')
  return {
    title: archiveT('filter_category', { name: category?.name || slug }),
    description: category?.description || undefined,
    alternates: { canonical: category ? getCategoryUrl(category) : undefined },
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

  const categories = await getCachedCategories()
  const category = categories?.find(c => c.slug === slug)
  // 分类列表获取成功但不存在该 slug 时返回 404
  if (categories && !category)
    notFound()

  const { posts, total } = await listPosts({
    page,
    size: PAGE_SIZE,
    category: slug,
    orderBy: OrderBy.CreatedAt,
    desc: true,
  }).then(res => ({ posts: res.data.posts || [], total: res.data.total || 0 })).catch(() => ({ posts: [], total: 0 }))

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const baseUrl = category ? getCategoryUrl(category) : `/c/${encodeURIComponent(slug)}`
  const pageUrl = (p: number) => (p <= 1 ? baseUrl : `${baseUrl}?page=${p}`)

  return (
    <SiteShell
      sidebar={(
        <BlogSidebar
          cards={[
            <BlogSidebarAbout key="about" />,
            <BlogSidebarLabels key="labels" />,
            <BlogSidebarHotPosts key="hot-posts" />,
          ]}
        />
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
