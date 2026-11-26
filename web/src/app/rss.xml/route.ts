import { cacheLife, cacheTag } from 'next/cache'
import { connection, NextResponse } from 'next/server'
import RSS from 'rss'
import { getRssData } from '@/api/misc'
import { CacheTag } from '@/lib/cache-tags'
import { renderInlineIconsHtml } from '@/lib/inline-icon/icon'
import { stripInlineMarkdown } from '@/utils/common/inline-markdown'
import { getPostUrl } from '@/utils/common/route'
import { absoluteSiteUrl, absolutizeHtmlUrls } from '@/utils/common/siteinfo'
import { formatDisplayName } from '@/utils/common/username'
import { renderMathHtml } from '@/utils/server/render-math'
import { sanitizeContentHtml } from '@/utils/server/sanitize-html'

function escapeXmlHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 构建阶段不预渲染（见 GET 开头的 connection()）；运行期将取数、正文公式/行内图标渲染与 XML 生成整体跨请求缓存，
// 文章或站点 SEO/RSS 配置变化时通过 posts / site 标签即时失效；后端异常时抛错不缓存失败结果
async function buildRssResult(): Promise<{ enabled: boolean, xml: string }> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Posts, CacheTag.Site)

  const rssData = (await getRssData()).data
  if (rssData.enabled === false) {
    return { enabled: false, xml: '' }
  }

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
    generator: 'neo-blog',
  })

  const fullContent = rssData.fullContent !== false
  const descriptions = fullContent
    ? await Promise.all(rssData.posts.map(async post => absolutizeHtmlUrls(
        await renderInlineIconsHtml(renderMathHtml(sanitizeContentHtml(post.content), 'mathml')),
        rssData.siteUrl,
      )))
    : rssData.posts.map((post) => {
        const postUrl = rssData.siteUrl + getPostUrl({ post })
        const summary = stripInlineMarkdown(post.description || '') || (post.excerpt || '').trim() || post.title
        return `<p>${escapeXmlHtml(summary)}</p><p><a href="${escapeXmlHtml(postUrl)}">${escapeXmlHtml(postUrl)}</a></p>`
      })

  rssData.posts.forEach((post, index) => {
    const rawEnclosure = absoluteSiteUrl(post.cover || rssData.postDefaultCover, rssData.siteUrl)
    const enclosureUrl = /^https?:\/\//i.test(rawEnclosure) ? rawEnclosure : ''
    rss.item({
      title: post.title,
      description: descriptions[index],
      url: rssData.siteUrl + getPostUrl({ post }),
      guid: post.slug || post.id.toString(),
      date: post.updatedAt,
      author: post.user ? formatDisplayName(post.user) : rssData.author,
      categories: post.category ? [post.category.name] : undefined,
      ...(enclosureUrl ? { enclosure: { url: enclosureUrl } } : {}),
    })
  })

  return { enabled: true, xml: rss.xml({ indent: true }) }
}

export async function GET() {
  await connection()
  const result = await buildRssResult().catch(() => null)
  if (!result) {
    return NextResponse.json(
      { error: 'Failed to fetch RSS data' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  if (!result.enabled) {
    return new Response('RSS feed is disabled', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  }

  return new Response(result.xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  })
}
