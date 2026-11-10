import { unstable_cache } from 'next/cache'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getCategories, listPosts } from '@/api/post'
import { CacheTag, DETAIL_REVALIDATE_SECONDS } from '@/lib/cache-tags'
import { OrderBy } from '@/models/common'

// 没有按 slug 查询分类的接口，从分类列表中查找。分类列表跨请求缓存：分类页读 searchParams（分页）仍按请求渲染，
// 但视口预取（只跑到 layout）与页面渲染不再每次打后端；分类增删改时 posts 标签失效
const loadCategories = unstable_cache(
  async () => getCategories().then(res => res.data.categories),
  ['categories'],
  { revalidate: DETAIL_REVALIDATE_SECONDS, tags: [CacheTag.Posts] },
)

// layout、generateMetadata 与页面共享同一次读取；取不到时不缓存
const getCachedCategories = cache(async () => loadCategories().catch(() => null))

/**
 * 按 slug 找分类：分类列表取到了但没有这个 slug 时 404；列表取不到时返回 undefined，页面按 slug 照常显示。
 * 由 layout.tsx 在 loading.tsx 的骨架流出之前调用，状态码才是真正的 404
 */
export async function findCategoryOr404(slug: string) {
  const categories = await getCachedCategories()
  const category = categories?.find(c => c.slug === slug)
  if (categories && !category)
    notFound()
  return category
}

/** 分类页每页的文章数 */
export const CATEGORY_PAGE_SIZE = 20

function fetchCategoryPosts(slug: string, page: number) {
  return listPosts({
    page,
    size: CATEGORY_PAGE_SIZE,
    category: slug,
    orderBy: OrderBy.CreatedAt,
    desc: true,
  }).then(res => ({ posts: res.data.posts || [], total: res.data.total || 0 }))
}

// 只缓存第一页（文章、分类、标签变化时 posts 标签失效）：页码来自地址栏，随手就能拼出无数个，翻页也少，后面的页照常向后端取
const loadFirstPage = unstable_cache(
  async (slug: string) => fetchCategoryPosts(slug, 1),
  ['category-posts'],
  { revalidate: DETAIL_REVALIDATE_SECONDS, tags: [CacheTag.Posts] },
)

/** 分类下某一页的文章；取不到时抛错、不进缓存，由页面按空列表显示 */
export function listCategoryPosts(slug: string, page: number) {
  return page === 1 ? loadFirstPage(slug) : fetchCategoryPosts(slug, page)
}
