import type { Metadata } from 'next'
import type { SiteInfo } from '@/utils/common/siteinfo'
import { localeAlternates } from '@/i18n/alternates'
import { localizePath, resolveRouteLocale, routing } from '@/i18n/routing'
import { safeMetadataBase } from '@/utils/common/siteinfo'

const META_CONTENT_RE = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i

/**
 * 提取站长验证 token：兼容直接粘贴验证码字符串或误粘贴完整 <meta ... content="..."> 标签
 */
export function extractVerificationToken(raw?: string | null): string | undefined {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed)
    return undefined
  if (/<meta\b/i.test(trimmed)) {
    const matched = META_CONTENT_RE.exec(trimmed)
    if (!matched)
      return undefined
    const token = (matched[1] ?? matched[2] ?? '').replace(/[\r\n\t<>"]/g, '').trim()
    return token || undefined
  }
  const token = trimmed.replace(/[\r\n\t<>"]/g, '').trim()
  return token || undefined
}

/**
 * 规整 Twitter / X 账号为 @handle 形式（兼容输入 @foo、foo 或 https://x.com/foo）
 */
export function normalizeTwitterHandle(raw?: string | null): string | undefined {
  let trimmed = raw?.trim() ?? ''
  if (!trimmed)
    return undefined
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      const seg = parsed.pathname.split('/').filter(Boolean)[0] ?? ''
      trimmed = seg
    }
    catch {
      return undefined
    }
  }
  const clean = trimmed.replace(/^@+/, '').replace(/\W/g, '')
  return clean ? `@${clean}` : undefined
}

/**
 * 首页完整 <title>：优先使用后台「首页 SEO 标题」，留空继承「站点名 - 站长签名」或站点名，避免弱语义的「首页 - 站点名」
 */
export function resolveHomeSeoTitle(siteInfo?: Partial<SiteInfo> | null): string {
  const custom = siteInfo?.seo?.homeTitle?.trim()
  if (custom)
    return custom
  const siteName = siteInfo?.metadata?.name?.trim() || 'My Blog'
  const motto = siteInfo?.owner?.motto?.trim()
  return motto ? `${siteName} - ${motto}` : siteName
}

/**
 * 默认 SEO 描述：优先使用后台「首页 SEO 描述」，留空继承站点简介
 */
export function resolveDefaultSeoDescription(siteInfo?: Partial<SiteInfo> | null): string {
  return siteInfo?.seo?.homeDescription?.trim() || siteInfo?.metadata?.description?.trim() || ''
}

/**
 * 默认社交分享图（OG Image）：依次取后台「默认分享图」 -> 默认封面首张 -> 站点图标
 */
export function resolveDefaultOgImage(siteInfo?: Partial<SiteInfo> | null): string | undefined {
  const custom = siteInfo?.seo?.ogImage?.trim()
  if (custom)
    return custom
  const defaultCover = Array.isArray(siteInfo?.defaultCover)
    ? siteInfo?.defaultCover[0]?.trim()
    : siteInfo?.defaultCover?.trim()
  if (defaultCover)
    return defaultCover
  const icon = siteInfo?.metadata?.icon?.trim()
  return icon || undefined
}

/**
 * 生成根布局搜索引擎站长平台验证元标签（Google / Bing / Baidu）
 */
export function buildSiteVerification(siteInfo?: Partial<SiteInfo> | null): Metadata['verification'] | undefined {
  const google = extractVerificationToken(siteInfo?.seo?.googleVerification)
  const bing = extractVerificationToken(siteInfo?.seo?.bingVerification)
  const baidu = extractVerificationToken(siteInfo?.seo?.baiduVerification)
  if (!google && !bing && !baidu)
    return undefined
  const other: Record<string, string> = {}
  if (bing)
    other['msvalidate.01'] = bing
  if (baidu)
    other['baidu-site-verification'] = baidu
  return {
    ...(google ? { google } : {}),
    ...(Object.keys(other).length > 0 ? { other } : {}),
  }
}

/**
 * 计算公开页面的 robots 指令：
 * 1. 全站禁止索引（allowIndexing === false） -> noindex, nofollow
 * 2. 非默认语言且策略为 noindex_follow -> noindex, follow
 * 3. 其余正常开放索引
 */
export function buildSeoRobots(
  locale: string,
  siteInfo?: Partial<SiteInfo> | null,
  richPreview = false,
): Metadata['robots'] {
  if (siteInfo?.seo?.allowIndexing === false) {
    return {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    }
  }
  const localeMode = siteInfo?.seo?.localeIndexMode ?? 'canonical_default'
  if (resolveRouteLocale(locale) !== routing.defaultLocale && localeMode === 'noindex_follow') {
    return {
      index: false,
      follow: true,
      googleBot: { index: false, follow: true },
    }
  }
  if (richPreview) {
    return {
      index: true,
      follow: true,
      googleBot: {
        'index': true,
        'follow': true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    }
  }
  return {
    index: true,
    follow: true,
  }
}

export interface PublicPageMetadataOptions {
  locale: string
  pathname: string
  siteInfo: SiteInfo
  title?: Metadata['title']
  socialTitle?: string
  description?: string
  keywords?: string[]
  image?: string | { url: string, width?: number, height?: number, alt?: string }
  ogType?: 'website' | 'article' | 'profile'
  twitterCard?: 'summary' | 'summary_large_image'
  richRobots?: boolean
  forceNoIndex?: boolean
}

/**
 * 统一构造前台公开页面的完整 Metadata（含 canonical / hreflang 策略、OG、Twitter Card、关键词与索引控制）
 */
export function buildPublicPageMetadata(opts: PublicPageMetadataOptions): Metadata {
  const {
    locale,
    pathname,
    siteInfo,
    title,
    description: rawDesc,
    keywords,
    image,
    ogType = 'website',
    twitterCard,
    richRobots = false,
    forceNoIndex = false,
  } = opts

  const siteName = siteInfo.metadata?.name?.trim() || undefined
  const description = rawDesc?.trim() || resolveDefaultSeoDescription(siteInfo) || undefined
  const resolvedKeywords = keywords?.length
    ? keywords
    : (siteInfo.keywords?.length ? siteInfo.keywords : undefined)

  const resolvedTitleText = opts.socialTitle
    || (typeof title === 'string'
      ? (siteName ? `${title} - ${siteName}` : title)
      : (siteName || ''))

  const fallbackImg = resolveDefaultOgImage(siteInfo)
  const ogImages = image
    ? [typeof image === 'string' ? { url: image, alt: resolvedTitleText } : image]
    : (fallbackImg ? [{ url: fallbackImg, alt: siteName || resolvedTitleText }] : undefined)
  const twitterImages = image
    ? [typeof image === 'string' ? image : image.url]
    : (fallbackImg ? [fallbackImg] : undefined)

  const twitterHandle = normalizeTwitterHandle(siteInfo.seo?.twitterHandle)
  const cardType = twitterCard ?? (siteInfo.seo?.twitterCard === 'summary' ? 'summary' : 'summary_large_image')
  const localeMode = siteInfo.seo?.localeIndexMode ?? 'canonical_default'
  const rssEnabled = siteInfo.seo?.rssEnabled ?? true

  const robots: Metadata['robots'] = forceNoIndex
    ? (siteInfo.seo?.allowIndexing === false
        ? { index: false, follow: false, googleBot: { index: false, follow: false } }
        : { index: false, follow: true, googleBot: { index: false, follow: true } })
    : buildSeoRobots(locale, siteInfo, richRobots)

  // canonical 遵循多语言收敛策略：默认指向无前缀默认语言 URL，社交分享 og:url 同步对齐规范地址
  const canonicalUrl = localeMode === 'independent'
    ? localizePath(pathname, locale)
    : localizePath(pathname, routing.defaultLocale)

  return {
    ...(title !== undefined ? { title } : {}),
    description,
    metadataBase: safeMetadataBase(siteInfo.baseUrl),
    keywords: resolvedKeywords,
    alternates: localeAlternates(pathname, locale, localeMode, rssEnabled),
    openGraph: {
      title: resolvedTitleText || undefined,
      description,
      url: canonicalUrl,
      siteName,
      ...(ogImages ? { images: ogImages } : {}),
      locale: locale.replace('-', '_'),
      type: ogType,
    },
    twitter: {
      card: cardType,
      title: resolvedTitleText || undefined,
      description,
      ...(twitterHandle ? { site: twitterHandle, creator: twitterHandle } : {}),
      ...(twitterImages ? { images: twitterImages } : {}),
    },
    robots,
  }
}

export interface RobotsRuleGroup {
  userAgent: string | string[]
  allow?: string | string[]
  disallow?: string | string[]
  crawlDelay?: number
}

/**
 * 解析后台配置的额外 robots.txt 规则文本：
 * - 支持多段 `User-agent:` 分组及组内的 `Allow:` / `Disallow:` / `Crawl-delay:`
 * - 未先声明 `User-agent:` 的顶层 `Allow:` / `Disallow:` 自动并入默认 `*` 规则之后
 * - 剥离 `#` 注释与非法换行控制字符
 */
export function parseExtraRobotsRules(raw?: string | null): {
  rootAllow: string[]
  rootDisallow: string[]
  rootCrawlDelay?: number
  groups: RobotsRuleGroup[]
} {
  const rootAllow: string[] = []
  const rootDisallow: string[] = []
  let rootCrawlDelay: number | undefined
  const groups: RobotsRuleGroup[] = []

  if (!raw?.trim())
    return { rootAllow, rootDisallow, groups }

  let currentAgents: string[] = []
  let currentAllow: string[] = []
  let currentDisallow: string[] = []
  let currentCrawlDelay: number | undefined
  let inRuleBody = false

  const flushGroup = () => {
    if (currentAgents.length === 0)
      return
    if (currentAllow.length > 0 || currentDisallow.length > 0 || currentCrawlDelay !== undefined) {
      groups.push({
        userAgent: currentAgents.length === 1 ? currentAgents[0] : [...currentAgents],
        ...(currentAllow.length > 0 ? { allow: [...currentAllow] } : {}),
        ...(currentDisallow.length > 0 ? { disallow: [...currentDisallow] } : {}),
        ...(currentCrawlDelay !== undefined ? { crawlDelay: currentCrawlDelay } : {}),
      })
    }
    currentAgents = []
    currentAllow = []
    currentDisallow = []
    currentCrawlDelay = undefined
    inRuleBody = false
  }

  for (const rawLine of raw.split(/\r?\n/)) {
    const cleanLine = rawLine.replace(/#.*$/, '').trim()
    if (!cleanLine)
      continue
    const colonIdx = cleanLine.indexOf(':')
    if (colonIdx <= 0)
      continue
    const directive = cleanLine.slice(0, colonIdx).trim().toLowerCase()
    const value = cleanLine.slice(colonIdx + 1).replace(/[\r\n]/g, '').trim()

    if (directive === 'user-agent') {
      if (!value)
        continue
      if (inRuleBody)
        flushGroup()
      currentAgents.push(value)
      continue
    }

    if (directive === 'allow') {
      if (!value)
        continue
      if (currentAgents.length === 0) {
        rootAllow.push(value)
      }
      else {
        inRuleBody = true
        currentAllow.push(value)
      }
    }
    else if (directive === 'disallow') {
      if (currentAgents.length === 0) {
        if (value)
          rootDisallow.push(value)
      }
      else {
        inRuleBody = true
        currentDisallow.push(value)
      }
    }
    else if (directive === 'crawl-delay') {
      const delay = Number.parseFloat(value)
      if (Number.isFinite(delay) && delay >= 0) {
        if (currentAgents.length === 0) {
          rootCrawlDelay = delay
        }
        else {
          inRuleBody = true
          currentCrawlDelay = delay
        }
      }
    }
  }
  flushGroup()

  return { rootAllow, rootDisallow, rootCrawlDelay, groups }
}
