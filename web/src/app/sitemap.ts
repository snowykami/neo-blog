import type { MetadataRoute } from 'next'
import { connection } from 'next/server'
import { getSitemapData } from '@/api/misc'
import { languageAlternates } from '@/i18n/alternates'
import { localizePath, routing } from '@/i18n/routing'
import { getCategoryUrl, getPageUrl, getPostUrl, getUserUrl } from '@/utils/common/route'

// 每次请求时生成（见函数开头的 connection()）：构建阶段连不上后端，预渲染会把空的站点地图缓存下来，每次发布后都要空一段时间

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
 * - 每种界面语言一条地址（简体中文不带前缀，其余如 /en/p/x），互相用 xhtml:link hreflang 指向，见 i18n/alternates.ts
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection()
  // 后端不可用时返回错误（500），不能返回空列表，否则搜索引擎会当作全站没有页面
  const sitemapData = (await getSitemapData()).data
  const baseUrl = sitemapData.baseUrl.replace(/\/+$/, '')

  const posts = sitemapData.posts || []
  // 首页与归档页的内容由文章列表构成，lastmod 取最新一篇的最后修改时间
  const listLastModified = latestDate(...posts.map(post => post.updatedAt || post.createdAt))

  // [不带语言前缀的路径, 最后修改时间]
  const entries: [string, Date | undefined][] = [
    ['/', listLastModified],
    ['/a', listLastModified],
    ['/l', listLastModified],
    ...posts.map(post => [getPostUrl({ post }), latestDate(post.updatedAt, post.createdAt)] as [string, Date | undefined]),
    // 公开的独立页面
    ...(sitemapData.pages ?? []).map(page => [getPageUrl(page), latestDate(page.updatedAt)] as [string, Date | undefined]),
    // editors
    ...(sitemapData.editors ?? []).map(editor => [getUserUrl(editor), latestDate(editor.updatedAt)] as [string, Date | undefined]),
    // categories
    ...(sitemapData.categories ?? []).map(category => [getCategoryUrl(category), latestDate(category.updatedAt)] as [string, Date | undefined]),
  ]

  // 每种界面语言的地址各占一条，并用 hreflang 互相指向（含 x-default）：
  // 正文不翻译，界面语言不同，搜索引擎按访客语言展示对应的地址
  const absolute = (path: string) => (path === '/' ? baseUrl || '/' : `${baseUrl}${path}`)
  return entries.flatMap(([path, lastModified]) => {
    const languages = Object.fromEntries(Object.entries(languageAlternates(path)).map(([code, href]) => [code, absolute(href)]))
    return routing.locales.map(locale => ({
      url: absolute(localizePath(path, locale)),
      lastModified,
      alternates: { languages },
    }))
  })
}
