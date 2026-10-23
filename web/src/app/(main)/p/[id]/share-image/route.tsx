import type { SiteInfo } from '@/utils/common/siteinfo'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { getTranslations } from 'next-intl/server'
import { ImageResponse } from 'next/og'
import QRCode from 'qrcode'
import { getCachedSiteInfo } from '@/api/misc.server'
import { getPostByIdServer } from '@/api/post.server'
import { SHARE_CARD_SIZE, ShareCard } from '@/components/blog-post/share-card'
import { stripInlineMarkdown } from '@/utils/common/inline-markdown'
import { getPostUrl } from '@/utils/common/route'
import { formatDisplayName } from '@/utils/common/username'

/*
 * 文章分享图（Open Graph / Twitter Card），同时用于站内「分享」弹窗的预览：
 * - 访问路径 /p/{slug 或 id}/share-image，排版见 components/blog-post/share-card.tsx
 * - 用 route handler 而不是 opengraph-image 文件约定：约定文件放在 (main) 路由组里不生效（Next 16.4 + Turbopack），
 *   改由 page.tsx 的 generateMetadata 显式写入 og:image / twitter:image
 * - 标题摘要按字符数截断；封面抓取失败、文章不存在时仍然出图，不让爬虫拿到错误页
 * - 字体为 Noto Sans SC 子集（satori 只支持 ttf / otf / woff），生成方式见 src/assets/fonts/README.md
 */

const FONT_FILE = new URL('../../../../../assets/fonts/NotoSansSC-Medium.subset.ttf', import.meta.url)
// 字体只读取一次，后续请求复用同一个 Promise
const fontData = readFile(FONT_FILE)

// 截断长度按竖版卡片一行约 15 个汉字估算：无封面时标题 4 行、摘要 3 行
const TITLE_MAX = 56
const DESC_MAX = 78
// 带封面时下方要给图片留位置，标题收到 3 行、摘要 2 行
const TITLE_MAX_COVER = 42
const DESC_MAX_COVER = 54
const LABEL_MAX = 3
const LABEL_MAX_CHARS = 12
const SITE_NAME_MAX = 18
// 抓图（封面 / 站点图标）的最长等待，慢图直接跳过，避免分享图接口变慢
const IMAGE_TIMEOUT_MS = 4000
const IMAGE_MAX_BYTES = 6_000_000
// 分享图按文章内容生成，变化不频繁：浏览器缓存 1 小时，CDN 缓存 1 天
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [post, siteInfo, font, scanText] = await Promise.all([
    getPostByIdServer({ id }).then(res => res.data).catch(() => null),
    getCachedSiteInfo(),
    fontData,
    scanTextOfRequest(),
  ])

  const postPath = post
    ? getPostUrl({ post })
    : `/p/${encodeURIComponent(id)}`
  // 二维码必须是绝对地址：优先站点配置，没配置时退回本次请求的域名
  const origin = siteInfo.baseUrl?.replace(/\/+$/, '') || new URL(request.url).origin
  const absoluteUrl = `${origin}${postPath}`

  const [cover, logo, qr] = await Promise.all([
    toDataUrl(post?.cover, siteInfo),
    toDataUrl(siteInfo.metadata.icon, siteInfo),
    toQrDataUrl(absoluteUrl),
  ])

  // 标签、站点名过长时截断，避免整行超出画布宽度
  const labels = (post?.labels ?? []).map(label => clip(label.name, LABEL_MAX_CHARS)).filter(Boolean).slice(0, LABEL_MAX)
  const author = post?.user ? formatDisplayName(post.user) : ''
  const date = post?.createdAt ? post.createdAt.slice(0, 10) : ''

  return new ImageResponse(
    (
      <ShareCard
        siteName={clip(siteInfo.metadata.name, SITE_NAME_MAX)}
        siteHost={hostOf(origin)}
        colorScheme={siteInfo.defaultColorScheme}
        title={clip(plainText(post?.title) || siteInfo.metadata.name, cover ? TITLE_MAX_COVER : TITLE_MAX)}
        description={clip(plainText(post?.description) || siteInfo.metadata.description, cover ? DESC_MAX_COVER : DESC_MAX)}
        labels={labels}
        // 作者与日期用中点连接，缺一项时不留下多余的分隔符
        meta={[author, date].filter(Boolean).join(' · ')}
        cover={cover}
        logo={logo}
        qr={qr}
        scanText={scanText}
      />
    ),
    {
      ...SHARE_CARD_SIZE,
      fonts: [{ name: 'Noto Sans SC', data: font, weight: 500, style: 'normal' }],
      headers: { 'Cache-Control': CACHE_CONTROL },
    },
  )
}

/** 二维码下方提示语跟随界面语言，取不到时退回中文 */
async function scanTextOfRequest() {
  try {
    return await getTranslations('Share').then(t => t('card_scan'))
  }
  catch {
    return '扫码阅读全文'
  }
}

function plainText(value?: string | null) {
  return value ? stripInlineMarkdown(value).replace(/\s+/g, ' ').trim() : ''
}

function clip(text: string, max: number) {
  if (text.length <= max)
    return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}

function hostOf(origin?: string) {
  if (!origin)
    return ''
  try {
    return new URL(origin).host
  }
  catch {
    return ''
  }
}

/** 二维码：转成 data URL 交给 satori 绘制，容错率取 M，够扫但不至于太密 */
async function toQrDataUrl(url: string) {
  try {
    const buffer = await QRCode.toBuffer(url, {
      type: 'png',
      // 留出 2 个模块的白边，配合圆角与卡片背景保证可扫
      margin: 2,
      width: 300,
      errorCorrectionLevel: 'M',
      color: { dark: '#16181dff', light: '#ffffffff' },
    })
    return `data:image/png;base64,${buffer.toString('base64')}`
  }
  catch {
    return null
  }
}

/**
 * 图片转成 data URL：satori 只认 data URL 或可直接抓取的地址，
 * 站内图片是相对路径，统一按站点地址补全；失败、超时、非图片时返回 null
 */
async function toDataUrl(src: string | null | undefined, siteInfo: SiteInfo) {
  if (!src)
    return null
  const url = src.startsWith('http') ? src : `${siteInfo.baseUrl ?? ''}${src.startsWith('/') ? '' : '/'}${src}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !type.startsWith('image/'))
      return null
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.byteLength > IMAGE_MAX_BYTES)
      return null
    return `data:${sniffMime(bytes, type)};base64,${bytes.toString('base64')}`
  }
  catch {
    return null
  }
}

/**
 * 按文件头识别真实图片格式：部分图床把 jpeg 标成 image/png，
 * satori 按声明的类型解码会失败，图片就整块空白
 */
function sniffMime(bytes: Buffer, fallbackType: string) {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8)
    return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50)
    return 'image/png'
  if (bytes[0] === 0x47 && bytes[1] === 0x49)
    return 'image/gif'
  if (bytes[8] === 0x57 && bytes[9] === 0x45)
    return 'image/webp'
  return fallbackType.split(';')[0] || 'image/png'
}
