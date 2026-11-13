import { cacheLife, cacheTag } from 'next/cache'
import { connection, NextResponse } from 'next/server'
import RSS from 'rss'
import { getRssData } from '@/api/misc'
import { CacheTag } from '@/lib/cache-tags'
import { renderInlineIconsHtml } from '@/lib/inline-icon/icon'
import { getPostUrl } from '@/utils/common/route'
import { absoluteSiteUrl, absolutizeHtmlUrls } from '@/utils/common/siteinfo'
import { formatDisplayName } from '@/utils/common/username'
import { renderMathHtml } from '@/utils/server/render-math'
import { sanitizeContentHtml } from '@/utils/server/sanitize-html'

// 构建阶段不预渲染（见 GET 开头的 connection()）；运行期将取数、正文公式/行内图标渲染与 XML 生成整体跨请求缓存，
// 文章或站点配置变化时通过 posts / site 标签即时失效；后端异常时抛错不缓存失败结果
async function buildRssXml(): Promise<string> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Posts, CacheTag.Site)

  const rssData = (await getRssData()).data
  const rss = new RSS({
    title: rssData.title,
    description: rssData.description,
    site_url: rssData.siteUrl,
    feed_url: rssData.feedUrl,
    // 站内图片存的是相对路径，订阅源里要补成绝对地址
    image_url: absoluteSiteUrl(rssData.imageUrl, rssData.siteUrl) || undefined,
    copyright: rssData.copyright,
    language: rssData.language,
    // 后台「RSS 作者」配置
    managingEditor: rssData.author || undefined,
    webMaster: rssData.author || undefined,
    pubDate: rssData.pubDate || undefined,
    generator: 'Next.js with rss',
  })

  // 订阅源同样输出净化后的正文
  // 公式输出为 MathML、行内图标输出为带 1em 宽高的 SVG：阅读器不加载站点样式也能正常显示（不支持 SVG 的阅读器里图标不显示）
  // 站内图片与链接存的是相对路径，补成绝对地址
  const descriptions = await Promise.all(rssData.posts.map(async post => absolutizeHtmlUrls(
    await renderInlineIconsHtml(renderMathHtml(sanitizeContentHtml(post.content), 'mathml')),
    rssData.siteUrl,
  )))
  rssData.posts.forEach((post, index) => {
    rss.item({
      title: post.title,
      description: descriptions[index],
      url: rssData.siteUrl + getPostUrl({ post }),
      guid: post.slug || post.id.toString(),
      date: post.updatedAt,
      author: post.user ? formatDisplayName(post.user) : rssData.author,
      categories: post.category ? [post.category.name] : undefined,
      enclosure: { url: absoluteSiteUrl(post.cover || rssData.postDefaultCover, rssData.siteUrl) },
    })
  })

  return rss.xml({ indent: true })
}

export async function GET() {
  await connection()
  const xml = await buildRssXml().catch(() => null)
  if (!xml) {
    return NextResponse.json({ error: 'Failed to fetch RSS data' }, { status: 500 })
  }

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  })
}
