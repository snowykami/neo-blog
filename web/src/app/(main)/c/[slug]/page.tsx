import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { getCategories, listPosts } from '@/api/post'
import { BlogCardGrid } from '@/components/blog-home/blog-home-card'
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

  // 没有按 slug 查询分类的接口，从分类列表中查找以显示分类名
  const categories = await getCategories().then(res => res.data.categories).catch(() => null)
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
    <div className="py-10">
      <h1 className="text-3xl font-bold mb-6">
        {archiveT('filter_category', { name: category?.name || slug })}
      </h1>
      <BlogCardGrid posts={posts} />
      {totalPages > 1 && (
        <Pagination className="mt-8">
          <PaginationContent>
            {page > 1 && (
              <PaginationItem>
                <PaginationPrevious href={pageUrl(page - 1)} aria-label={operationT('previous')} />
              </PaginationItem>
            )}
            <PaginationItem>
              <span className="px-3 text-sm text-muted-foreground">
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
    </div>
  )
}
