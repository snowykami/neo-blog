import type { Category } from '@/models/category'
import type { Post } from '@/models/post'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getCategories, listPosts } from '@/api/post'
import { CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { OrderBy } from '@/models/common'

// 没有按 slug 查询分类的接口，从分类列表中查找。分类列表跨请求缓存（分类页、分类列表页、侧栏共用）；分类增删改时 posts 标签失效。
// 取不到时抛错（不缓存）
async function loadCategories(): Promise<Category[]> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Posts)
  return getCategories().then(res => res.data.categories ?? [])
}

/** 分类列表（跨请求缓存）；同一次渲染里多处调用只读一次。取不到时抛错 */
export const getCachedCategories = cache(async (): Promise<Category[]> => {
  skipBackendAtBuild()
  return loadCategories()
})

/**
 * 按 slug 找分类：分类列表取到了但没有这个 slug 时 404；列表取不到时返回 undefined，页面按 slug 照常显示。
 * 在 loading.tsx 的骨架里面调用也能得到真正的 404（见 p/[id]/post-data.ts 的说明）
 */
export async function findCategoryOr404(slug: string): Promise<Category | undefined> {
  const categories = await getCachedCategories().catch(() => null)
  const category = categories?.find(c => c.slug === slug)
  if (categories && !category)
    notFound()
  return category
}

/** 分类页每页的文章数 */
export const CATEGORY_PAGE_SIZE = 20

function fetchCategoryPosts(slug: string, page: number): Promise<{ posts: Post[], total: number }> {
  return listPosts({
    page,
    size: CATEGORY_PAGE_SIZE,
    category: slug,
    orderBy: OrderBy.CreatedAt,
    desc: true,
  }).then(res => ({ posts: res.data.posts || [], total: res.data.total || 0 }))
}

// 只缓存第一页（文章、分类、标签变化时 posts 标签失效）：页码来自地址栏，随手就能拼出无数个，翻页也少，后面的页照常向后端取。
// slug 已确认是存在的分类（findCategoryOr404 之后才调用），条目数不超过分类数
async function loadFirstPage(slug: string): Promise<{ posts: Post[], total: number }> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Posts)
  return fetchCategoryPosts(slug, 1)
}

/** 分类下某一页的文章；取不到时抛错、不进缓存，由页面按空列表显示。同一次渲染里标题的篇数与列表共用一次读取 */
export const listCategoryPosts = cache((slug: string, page: number): Promise<{ posts: Post[], total: number }> => {
  skipBackendAtBuild()
  return page === 1 ? loadFirstPage(slug) : fetchCategoryPosts(slug, page)
})
