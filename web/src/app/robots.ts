import { getSitemapData } from '@/api/misc'
import type { MetadataRoute } from 'next'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const sitemapData = await getSitemapData().then(res => res.data).catch(() => null)
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: ['/console/'],
      },
    ],
    sitemap: sitemapData?.baseUrl + "/sitemap.xml",
  }
}