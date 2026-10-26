import type { MetadataRoute } from 'next'
import { getCachedSiteInfo } from '@/api/misc.server'

// 每次重新验证时重算：构建阶段后端不可达也不会把「没有 Sitemap 行」的 robots.txt 固化下来
export const revalidate = 3600

/**
 * robots.txt 里必须始终带 Sitemap 行，否则搜索引擎只能依赖此前手动提交过的地图
 * 站点信息走缓存接口（比 sitemap-data 轻量），失败时回退到 fallbackSiteInfo
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const siteInfo = await getCachedSiteInfo()
  const baseUrl = siteInfo.baseUrl?.replace(/\/+$/, '')
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: ['/console/', '/auth/'],
      },
    ],
    sitemap: baseUrl ? `${baseUrl}/sitemap.xml` : undefined,
  }
}
