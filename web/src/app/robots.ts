import type { MetadataRoute } from 'next'
import { connection } from 'next/server'
import { getCachedSiteInfoOrFallback } from '@/api/misc.server'
import { LOCALE_PREFIXES, routing } from '@/i18n/routing'
import { parseExtraRobotsRules } from '@/lib/seo'

// 每次请求时生成（见函数开头的 connection()）：站点信息走跨请求缓存接口，后台修改 SEO 配置后通过 site 标签即时更新
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection()
  const siteInfo = await getCachedSiteInfoOrFallback()
  if (siteInfo.seo?.allowIndexing === false) {
    return {
      rules: [
        {
          userAgent: '*',
          disallow: ['/'],
        },
      ],
    }
  }

  const baseUrl = siteInfo.baseUrl?.replace(/\/+$/, '')
  const extra = parseExtraRobotsRules(siteInfo.seo?.robotsExtraRules)
  const defaultDisallow = [
    '/console/',
    '/auth/',
    ...routing.locales.filter(locale => locale !== routing.defaultLocale).map(locale => `${LOCALE_PREFIXES[locale]}/auth/`),
    ...extra.rootDisallow,
  ]
  const sitemapEnabled = siteInfo.seo?.sitemapEnabled ?? true

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', ...extra.rootAllow],
        disallow: Array.from(new Set(defaultDisallow)),
        ...(extra.rootCrawlDelay !== undefined ? { crawlDelay: extra.rootCrawlDelay } : {}),
      },
      ...extra.groups,
    ],
    sitemap: sitemapEnabled && baseUrl ? `${baseUrl}/sitemap.xml` : undefined,
  }
}
