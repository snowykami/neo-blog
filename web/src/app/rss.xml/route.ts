import { NextResponse } from 'next/server'
import RSS from 'rss'
import { getRssData } from '@/api/misc'
import { getPostUrl } from '@/utils/common/route'

export async function GET() {
  const rssData = await getRssData().then(res => res.data).catch(() => null)

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
    generator: 'Next.js with rss',
  })

  rssData.posts.forEach((post) => {
    rss.item({
      title: post.title,
      description: post.content,
      url: rssData.siteUrl + getPostUrl({ post }),
      guid: post.slug || post.id.toString(),
      date: post.updatedAt,
      enclosure: post.cover ? { url: post.cover } : { url: rssData.postDefaultCover },
    })
  })

  return new Response(rss.xml({ indent: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  })
}
