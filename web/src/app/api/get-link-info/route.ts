import type { NextRequest } from 'next/server'
import * as cheerio from 'cheerio'
import { NextResponse } from 'next/server'

export interface LinkPreview {
  title: string
  description: string
  image?: string
  favicon?: string
  url: string
  siteName?: string
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  }

  try {
    // 验证 URL
    const urlObj = new URL(url)
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return NextResponse.json({ error: 'Invalid URL protocol' }, { status: 400 })
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
      },
      next: { revalidate: 3600 }, // 缓存 1 小时
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const html = await response.text()
    const $ = cheerio.load(html)

    // 提取 meta 信息
    const getMetaContent = (property: string) => {
      return (
        $(`meta[property="${property}"]`).attr('content')
        || $(`meta[name="${property}"]`).attr('content')
        || $(`meta[property="twitter:${property.replace('og:', '')}"]`).attr('content')
      )
    }

    const title
      = getMetaContent('og:title')
        || $('title').text()
        || getMetaContent('twitter:title')
        || 'No title'

    const description
      = getMetaContent('og:description')
        || $('meta[name="description"]').attr('content')
        || getMetaContent('twitter:description')
        || ''

    const image
      = getMetaContent('og:image')
        || getMetaContent('twitter:image')
        || $('link[rel="image_src"]').attr('href')

    const siteName = getMetaContent('og:site_name') || urlObj.hostname

    // 获取 favicon
    let favicon
      = $('link[rel="icon"]').attr('href')
        || $('link[rel="shortcut icon"]').attr('href')
        || $('link[rel="apple-touch-icon"]').attr('href')

    if (favicon && !favicon.startsWith('http')) {
      favicon = new URL(favicon, url).href
    }

    const preview: LinkPreview = {
      title: title.trim().substring(0, 100),
      description: description.trim().substring(0, 200),
      image: image ? (image.startsWith('http') ? image : new URL(image, url).href) : undefined,
      favicon: favicon || `${urlObj.origin}/favicon.ico`,
      url,
      siteName,
    }

    return NextResponse.json(preview)
  }
  catch (error) {
    console.error('Link preview error:', error)
    return NextResponse.json({ error: 'Failed to fetch link preview' }, { status: 500 })
  }
}
