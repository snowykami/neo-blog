import { NextResponse } from 'next/server'
import RSS from 'rss'
import { getRssData } from '@/api/misc'
import { getPostUrl } from '@/utils/common/route'
import { formatDisplayName } from '@/utils/common/username'
import { sanitizeContentHtml } from '@/utils/server/sanitize-html'

// 订阅源 10 分钟重新生成一次
export const revalidate = 600

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
      description: sanitizeContentHtml(post.content),
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
