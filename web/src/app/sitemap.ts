import type { MetadataRoute } from 'next'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { getSitemapData } from '@/api/misc'
import { languageAlternates } from '@/i18n/alternates'
import { localizePath, routing } from '@/i18n/routing'
import { CacheTag } from '@/lib/cache-tags'
import { getCategoryUrl, getPageUrl, getPostUrl, getUserUrl, mainPath } from '@/utils/common/route'

// 构建阶段不预渲染（见 sitemap() 开头的 connection()）；运行期跨请求缓存并在内容/友链/站点配置变更时按标签即时失效

/**
 * 取一组时间里最晚的一个；全部无效时返回 undefined（该字段直接省略）
 */
function latestDate(...dates: (string | Date | null | undefined)[]): Date | undefined {
  const times = dates
    .filter((date): date is string | Date => Boolean(date))
    .map(date => (date instanceof Date ? date.getTime() : new Date(date).getTime()))
    .filter(time => Number.isFinite(time))
  return times.length > 0 ? new Date(Math.max(...times)) : undefined
}

async function buildSitemapEntries(): Promise<{ enabled: boolean, entries: MetadataRoute.Sitemap }> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Posts, CacheTag.Pages, CacheTag.Users, CacheTag.Friends, CacheTag.Site)

  // 后端不可用时返回错误（500），不能返回空列表，否则搜索引擎会当作全站没有页面
  const sitemapData = (await getSitemapData()).data
  if (sitemapData.sitemapEnabled === false)
    return { enabled: false, entries: [] }

  const baseUrl = sitemapData.baseUrl.replace(/\/+$/, '')

  const posts = sitemapData.posts || []
  const categories = sitemapData.categories ?? []
  // 首页与归档页的内容由文章列表构成，lastmod 取最新一篇的最后修改时间
  const listLastModified = latestDate(...posts.map(post => post.updatedAt || post.createdAt))
  const categoriesLastModified = latestDate(...categories.map(cat => cat.updatedAt), listLastModified)

  // [不带语言前缀的规范路径, 最后修改时间]
  const entries: [string, Date | undefined][] = [
    ['/', listLastModified],
    [mainPath.archive, listLastModified],
    [mainPath.label, listLastModified],
    [mainPath.category, categoriesLastModified],
    ...(sitemapData.friendsEnabled !== false
      ? [[mainPath.friends, latestDate(sitemapData.friendsUpdatedAt)] as [string, Date | undefined]]
      : []),
    ...posts.map(post => [getPostUrl({ post }), latestDate(post.updatedAt, post.createdAt)] as [string, Date | undefined]),
    // 公开的独立页面（不含外链跳转页）
    ...(sitemapData.pages ?? []).map(page => [getPageUrl(page), latestDate(page.updatedAt)] as [string, Date | undefined]),
    // 创作者主页
    ...(sitemapData.editors ?? []).map(editor => [getUserUrl(editor), latestDate(editor.updatedAt)] as [string, Date | undefined]),
    // 分类详情页
    ...categories.map(category => [getCategoryUrl(category), latestDate(category.updatedAt)] as [string, Date | undefined]),
  ]

  const absolute = (path: string) => (path === '/' ? baseUrl || '/' : `${baseUrl}${path}`)

  // 默认仅输出默认语言规范地址（避免未翻译正文产生 8 倍重复 URL 分散权重）；后台显式开启 all_locales 时才展开全语种与 hreflang
  if (sitemapData.sitemapLocaleMode !== 'all_locales') {
    return {
      enabled: true,
      entries: entries.map(([path, lastModified]) => ({
        url: absolute(localizePath(path, routing.defaultLocale)),
        lastModified,
      })),
    }
  }

  return {
    enabled: true,
    entries: entries.flatMap(([path, lastModified]) => {
      const languages = Object.fromEntries(Object.entries(languageAlternates(path)).map(([code, href]) => [code, absolute(href)]))
      return routing.locales.map(locale => ({
        url: absolute(localizePath(path, locale)),
        lastModified,
        alternates: { languages },
      }))
    }),
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection()
  const result = await buildSitemapEntries()
  if (!result.enabled)
    notFound()
  return result.entries
}
