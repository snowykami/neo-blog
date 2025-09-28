import { getSitemapData } from '@/api/misc'
import { getCategoryUrl, getLabelUrl, getPostUrl, getUserUrl } from '@/utils/common/route'
import { MetadataRoute } from 'next'

export const revalidate = 3600 // 1 hour


function getChangeFreqAndPriority(lastModified: Date) {
  const ageDays = (Date.now() - lastModified.getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays < 1) return { changefreq: 'daily' as const, priority: 0.9 }
  if (ageDays < 30) return { changefreq: 'weekly' as const, priority: 0.8 }
  if (ageDays < 365) return { changefreq: 'monthly' as const, priority: 0.7 }
  return { changefreq: 'yearly' as const, priority: 0.5 }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sitemapData = await getSitemapData().then(res => res.data).catch(() => null)
  if (!sitemapData) {
    return []
  }

  const items: MetadataRoute.Sitemap = []

  items.push({
    url: sitemapData.baseUrl,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: 1,
  })

  // posts
  sitemapData?.posts?.forEach(post => {
    const lastMod = new Date(post.updatedAt || post.createdAt)
    const { changefreq, priority } = getChangeFreqAndPriority(lastMod)
    items.push({
      url: sitemapData.baseUrl + getPostUrl(post),
      lastModified: lastMod,
      changeFrequency: changefreq,
      priority,
    })
  })

  // editors
  sitemapData?.editors?.forEach(editor => {
    const lastMod = new Date(editor.updatedAt)
    const { changefreq, priority } = getChangeFreqAndPriority(lastMod)
    items.push({
      url: sitemapData.baseUrl + getUserUrl(editor),
      lastModified: lastMod,
      changeFrequency: changefreq,
      priority,
    })
  })

  // categories
  sitemapData?.categories?.forEach(category => {
    const lastMod = new Date(category.updatedAt)
    const { changefreq, priority } = getChangeFreqAndPriority(lastMod)
    items.push({
      url: sitemapData.baseUrl + getCategoryUrl(category),
      lastModified: lastMod,
      changeFrequency: changefreq,
      priority,
    })
  })

  // labels
  sitemapData?.labels?.forEach(label => {
    const lastMod = new Date(label.updatedAt)
    const { changefreq, priority } = getChangeFreqAndPriority(lastMod)
    items.push({
      url: sitemapData.baseUrl + getLabelUrl(label),
      lastModified: lastMod,
      changeFrequency: changefreq,
      priority,
    })
  })

  return items
}
