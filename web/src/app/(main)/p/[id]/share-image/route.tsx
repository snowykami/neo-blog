import type { SiteInfo } from '@/utils/common/siteinfo'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { ImageResponse } from 'next/og'
import { getCachedSiteInfo } from '@/api/misc.server'
import { getPostByIdServer } from '@/api/post.server'
import { SHARE_CARD_SIZE, ShareCard } from '@/components/blog-post/share-card'
import { stripInlineMarkdown } from '@/utils/common/inline-markdown'
import { formatDisplayName } from '@/utils/common/username'

/*
 * 文章分享图（Open Graph / Twitter Card），同时用于站内「分享」弹窗的预览：
 * - 访问路径 /p/{slug 或 id}/share-image，排版见 components/blog-post/share-card.tsx
 * - 用 route handler 而不是 opengraph-image 文件约定：约定文件放在 (main) 路由组里不生效（Next 16.4 + Turbopack），
 *   改由 generateMetadata 显式写入 og:image / twitter:image
 * - 标题摘要按字符数截断；封面抓取失败、文章不存在时仍然出图，不让爬虫拿到错误页
 * - 字体为 Noto Sans SC 子集（satori 只支持 ttf / otf / woff），生成方式见 src/assets/fonts/README.md
 */

const FONT_FILE = new URL('../../../../../assets/fonts/NotoSansSC-Medium.subset.ttf', import.meta.url)
// 字体只读取一次，后续请求复用同一个 Promise
const fontData = readFile(FONT_FILE)

const TITLE_MAX = 46
const DESC_MAX = 78
// 带封面时文字列只剩一半宽度，截断得更短，避免文字溢出画布
const TITLE_MAX_COVER = 28
const DESC_MAX_COVER = 52
const LABEL_MAX = 3
const LABEL_MAX_CHARS = 12
const SITE_NAME_MAX = 24
// 抓封面图的最长等待，慢图直接跳过，避免分享图接口变慢
const COVER_TIMEOUT_MS = 4000
const COVER_MAX_BYTES = 6_000_000
// 分享图按文章内容生成，变化不频繁：浏览器缓存 1 小时，CDN 缓存 1 天
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [post, siteInfo, font] = await Promise.all([
    getPostByIdServer({ id }).then(res => res.data).catch(() => null),
    getCachedSiteInfo(),
    fontData,
  ])

  // 标签、站点名过长时截断，避免整行超出画布宽度
  const labels = (post?.labels ?? []).map(label => clip(label.name, LABEL_MAX_CHARS)).filter(Boolean).slice(0, LABEL_MAX)
  const author = post?.user ? formatDisplayName(post.user) : ''
  const date = post?.createdAt ? post.createdAt.slice(0, 10) : ''
  const cover = await toDataUrl(post?.cover, siteInfo)

  return new ImageResponse(
    (
      <ShareCard
        siteName={clip(siteInfo.metadata.name, SITE_NAME_MAX)}
        siteHost={hostOf(siteInfo.baseUrl)}
        colorScheme={siteInfo.defaultColorScheme}
        title={clip(plainText(post?.title) || siteInfo.metadata.name, cover ? TITLE_MAX_COVER : TITLE_MAX)}
        description={clip(plainText(post?.description) || siteInfo.metadata.description, cover ? DESC_MAX_COVER : DESC_MAX)}
        labels={labels}
        // 作者与日期用中点连接，缺一项时不留下多余的分隔符
        meta={[author, date].filter(Boolean).join(' · ')}
        cover={cover}
      />
    ),
    {
      ...SHARE_CARD_SIZE,
      fonts: [{ name: 'Noto Sans SC', data: font, weight: 500, style: 'normal' }],
      headers: { 'Cache-Control': CACHE_CONTROL },
    },
  )
}

function plainText(value?: string | null) {
  return value ? stripInlineMarkdown(value).replace(/\s+/g, ' ').trim() : ''
}

function clip(text: string, max: number) {
  if (text.length <= max)
    return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}

function hostOf(baseUrl?: string) {
  if (!baseUrl)
    return ''
  try {
    return new URL(baseUrl).host
  }
  catch {
    return ''
  }
}

/**
 * 封面转成 data URL：satori 只认 data URL 或可直接抓取的地址，
 * 站内封面是相对路径，统一按站点地址补全；失败、超时、非图片时退回无封面排版
 */
async function toDataUrl(cover: string | null | undefined, siteInfo: SiteInfo) {
  if (!cover)
    return null
  const url = cover.startsWith('http') ? cover : `${siteInfo.baseUrl ?? ''}${cover.startsWith('/') ? '' : '/'}${cover}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(COVER_TIMEOUT_MS) })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !type.startsWith('image/'))
      return null
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength > COVER_MAX_BYTES)
      return null
    return `data:${type.split(';')[0]};base64,${Buffer.from(buffer).toString('base64')}`
  }
  catch {
    return null
  }
}
