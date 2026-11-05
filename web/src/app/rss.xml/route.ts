import { NextResponse } from 'next/server'
import RSS from 'rss'
import { getRssData } from '@/api/misc'
import { getPostUrl } from '@/utils/common/route'
import { formatDisplayName } from '@/utils/common/username'
import { renderMathHtml } from '@/utils/server/render-math'
import { sanitizeContentHtml } from '@/utils/server/sanitize-html'

// 每次请求时生成：构建阶段连不上后端，按 ISR 预渲染会把 500 缓存下来，每次发布后订阅源都要失败一段时间；
// 阅读器与 CDN 按下面的 Cache-Control 缓存 10 分钟
export const dynamic = 'force-dynamic'

export async function GET() {
  const rssData = await getRssData()
    .then(res => res.data)
    .catch(() => null)

  if (!rssData) {
    return NextResponse.json({ error: 'Failed to fetch RSS data' }, { status: 500 })
  }

  const rss = new RSS({
    title: rssData.title,
    description: rssData.description,
    site_url: rssData.siteUrl,
    feed_url: rssData.feedUrl,
    image_url: rssData.imageUrl,
    copyright: rssData.copyright,
    language: rssData.language,
    // 后台「RSS 作者」配置
    managingEditor: rssData.author || undefined,
    webMaster: rssData.author || undefined,
    pubDate: rssData.pubDate || undefined,
    generator: 'Next.js with rss',
  })

  rssData.posts.forEach((post) => {
    rss.item({
      title: post.title,
      // 订阅源同样输出净化后的正文
      // 公式输出为 MathML：阅读器不加载 KaTeX 样式也能显示
      description: renderMathHtml(sanitizeContentHtml(post.content), 'mathml'),
      url: rssData.siteUrl + getPostUrl({ post }),
      guid: post.slug || post.id.toString(),
      date: post.updatedAt,
      author: post.user ? formatDisplayName(post.user) : rssData.author,
      categories: post.category ? [post.category.name] : undefined,
      enclosure: post.cover ? { url: post.cover } : { url: rssData.postDefaultCover },
    })
  })

  return new Response(rss.xml({ indent: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  })
}
