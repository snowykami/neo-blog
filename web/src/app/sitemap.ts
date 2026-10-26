import type { MetadataRoute } from 'next'
import { getSitemapData } from '@/api/misc'
import { getCategoryUrl, getPostUrl, getUserUrl } from '@/utils/common/route'

// 站点地图每小时重新生成一次
export const revalidate = 3600

/**
 * 取一组时间里最晚的一个；全部无效时返回 undefined（该字段直接省略）
 */
function latestDate(...dates: (string | null | undefined)[]): Date | undefined {
  const times = dates
    .filter((date): date is string => Boolean(date))
    .map(date => new Date(date).getTime())
    .filter(time => Number.isFinite(time))
  return times.length > 0 ? new Date(Math.max(...times)) : undefined
}

/*
 * sitemap 约定（依据 Google 官方文档）：
 * - <priority> 与 <changefreq> 会被 Google 直接忽略，不再输出，避免暗示与实际不符的权重
 * - <lastmod> 只有在「始终准确」时才会被采用，因此这里只写真实的最后修改时间，
 *   绝不用本次生成时间顶替，否则整站 lastmod 都会失去参考价值
 * - <loc> 不允许带 #fragment，归档月份等锚点不再单独成条（它们和 /a 是同一个 URL）
 * - 标签筛选页 /?label=xxx 的 canonical 指向首页，不属于规范 URL，故不列入
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sitemapData = await getSitemapData()
    .then(res => res.data)
    .catch(() => null)

  if (!sitemapData) {
    return []
  }

  const posts = sitemapData.posts || []
  // 首页与归档页的内容由文章列表构成，lastmod 取最新一篇的最后修改时间
  const listLastModified = latestDate(...posts.map(post => post.updatedAt || post.createdAt))

  const items: MetadataRoute.Sitemap = []

  items.push({
    url: sitemapData.baseUrl,
    lastModified: listLastModified,
  })
  items.push({
    url: `${sitemapData.baseUrl}/a`,
    lastModified: listLastModified,
  })
  items.push({
    url: `${sitemapData.baseUrl}/l`,
    lastModified: listLastModified,
  })

  // posts
  posts.forEach((post) => {
    items.push({
      url: sitemapData.baseUrl + getPostUrl({ post }),
      lastModified: latestDate(post.updatedAt, post.createdAt),
    })
  })

  // editors
  sitemapData?.editors?.forEach((editor) => {
    items.push({
      url: sitemapData.baseUrl + getUserUrl(editor),
      lastModified: latestDate(editor.updatedAt),
    })
  })

  // categories
  sitemapData?.categories?.forEach((category) => {
    items.push({
      url: sitemapData.baseUrl + getCategoryUrl(category),
      lastModified: latestDate(category.updatedAt),
    })
  })

  return items
}
