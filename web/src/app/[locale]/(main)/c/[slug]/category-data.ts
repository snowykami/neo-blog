import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getCategories } from '@/api/post'

// 没有按 slug 查询分类的接口，从分类列表中查找；layout、generateMetadata 与页面共享同一次请求
const getCachedCategories = cache(async () => {
  return getCategories().then(res => res.data.categories).catch(() => null)
})

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
