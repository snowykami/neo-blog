import type { Metadata } from 'next'
import type { SiteInfo } from '@/utils/common/siteinfo'
import { localeAlternates } from '@/i18n/alternates'
import { LOCALE_PREFIXES, localizePath, resolveRouteLocale, routing } from '@/i18n/routing'
import { stripInlineMarkdown } from '@/utils/common/inline-markdown'
import { safeMetadataBase } from '@/utils/common/siteinfo'

const META_CONTENT_RE = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i
const CJK_CHAR_RE = /[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/u
const SENTENCE_END_CHARS = new Set(['。', '！', '？', '!', '?', '；', ';'])
const CLOSING_PAIR_CHARS = new Set(['”', '’', '」', '』', '》', '〉', '）', ')', ']', '"', '\''])
const CLAUSE_BREAK_CHARS = new Set(['，', '、', ',', '：', ':', '—'])
const TRAILING_DANGLING_RE = /[“‘"'(（「『《〈[{、，,：:；;—\-–·•\s]+$/u

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

function isShortMetaDescription(text: string): boolean {
  const codePoints = Array.from(text.trim())
  if (codePoints.length === 0)
    return true
  return CJK_CHAR_RE.test(text) ? codePoints.length < 25 : codePoints.length < 55
}

function appendDescriptionPart(current: string, part?: string | null): string {
  const next = part?.trim() ?? ''
  if (!next)
    return current
  if (!current)
    return next
  if (current.includes(next))
    return current
  if (next.includes(current))
    return next
  const endsWithPunct = /[.。!！?？;；]$/.test(current)
  if (endsWithPunct)
    return CJK_CHAR_RE.test(current) ? `${current}${next}` : `${current} ${next}`
  return CJK_CHAR_RE.test(current) || CJK_CHAR_RE.test(next)
    ? `${current}，${next}`
    : `${current} — ${next}`
}

/**
 * 首页与根布局兜底 SEO 描述：
 * - 后台显式填写了「首页 SEO 描述」时原样采用；
 * - 仅配置了较短的「站点简介」（如 8 字短句，易触发 Bing 描述过短告警）时，依次自然拼入站长签名与多语言兜底简介
 */
export function resolveHomeSeoDescription(
  siteInfo?: Partial<SiteInfo> | null,
  localizedFallback?: string | null,
): string {
  const explicitHome = siteInfo?.seo?.homeDescription?.trim()
  if (explicitHome)
    return explicitHome

  let desc = siteInfo?.metadata?.description?.trim() ?? ''
  if (!isShortMetaDescription(desc))
    return desc

  desc = appendDescriptionPart(desc, siteInfo?.owner?.motto)
  if (isShortMetaDescription(desc))
    desc = appendDescriptionPart(desc, localizedFallback)
  if (isShortMetaDescription(desc) && siteInfo?.keywords?.length) {
    const kwText = siteInfo.keywords.map(k => k.trim()).filter(Boolean).slice(0, 5).join(' / ')
    desc = appendDescriptionPart(desc, kwText)
  }
  return desc
}

export interface ContentMetaDescriptionInput {
  description?: string | null
  excerpt?: string | null
  contentHtml?: string | null
  title?: string | null
  minLength?: number
  maxLength?: number
}

const INLINE_HTML_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'cite',
  'code',
  'del',
  'em',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
])
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['“', '”'],
  ['「', '」'],
  ['『', '』'],
  ['《', '》'],
]

function extractCleanTextFromHtml(html: string): string {
  // 仅扫描前 6000 字符即可满足 ~155 字摘要需求；线性状态机剥离标签，跳过引号属性内的 `>`，
  // 且对行内格式化标签不插入多余空格（避免破坏中文连贯性）
  const head = html.slice(0, 6000)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|math)\b[\s\S]*?<\/\1>/gi, ' ')
  let out = ''
  let i = 0
  while (i < head.length) {
    if (head[i] !== '<') {
      out += head[i]
      i++
      continue
    }
    let j = i + 1
    if (head[j] === '/')
      j++
    const nameStart = j
    while (j < head.length && /[a-z0-9-]/i.test(head[j]))
      j++
    const tagName = head.slice(nameStart, j).toLowerCase()
    if (!tagName) {
      out += head[i]
      i++
      continue
    }
    let quote = ''
    while (j < head.length) {
      const ch = head[j]
      if (quote) {
        if (ch === quote)
          quote = ''
      }
      else if (ch === '"' || ch === '\'') {
        quote = ch
      }
      else if (ch === '>') {
        j++
        break
      }
      j++
    }
    if (!INLINE_HTML_TAGS.has(tagName))
      out += ' '
    i = j
  }
  return out
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 返回 chars[0..limit) 中首个尚未闭合的成对左引号/书名号下标；全部闭合时返回 -1 */
function findFirstUnclosedQuoteIndex(chars: readonly string[], limit: number): number {
  let earliest = -1
  for (const [open, close] of QUOTE_PAIRS) {
    const stack: number[] = []
    for (let i = 0; i < limit; i++) {
      if (chars[i] === open)
        stack.push(i)
      else if (chars[i] === close && stack.length > 0)
        stack.pop()
    }
    if (stack.length > 0 && (earliest === -1 || stack[0] < earliest))
      earliest = stack[0]
  }
  return earliest
}

/**
 * 提取文章或独立页面的 meta description：
 * - 手写 / AI 生成的独立摘要优先（仅剥离行内 Markdown 标记与多余空白）；
 * - 自动提取时：优先使用后端 HTML 分词器生成的 `excerpt`（无行内标签空格污染），无 `excerpt` 时从 `contentHtml` 安全提取；
 *   剥离标题前缀与重复首行标题，在 60–155 字符内的句末标点自然收尾，并确保不残留未闭合的半边左引号（如 `“`）
 */
export function buildContentMetaDescription(input: ContentMetaDescriptionInput): string {
  const manual = stripInlineMarkdown(input.description ?? '').replace(/\s+/g, ' ').trim()
  if (manual)
    return manual

  const rawExcerpt = input.excerpt?.trim() ?? ''
  const preTruncatedExcerpt = rawExcerpt.endsWith('…')
  const normalizedExcerpt = preTruncatedExcerpt ? rawExcerpt.slice(0, -1).trim() : rawExcerpt
  const rawBody = normalizedExcerpt || (input.contentHtml ? extractCleanTextFromHtml(input.contentHtml) : '')
  if (!rawBody)
    return ''

  // 剥离行首残余的 Markdown 标题/引用前缀，再折叠空白
  let cleaned = rawBody
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t>]*)/gm, '')
    .replace(/\s+/g, ' ')
    .trim()

  const cleanTitle = stripInlineMarkdown(input.title ?? '').replace(/\s+/g, ' ').trim()
  if (cleanTitle && cleaned.startsWith(cleanTitle) && cleaned.length > cleanTitle.length) {
    const rest = cleaned.slice(cleanTitle.length).replace(/^[:：—\-–|｜·•,，.。!！?？\s]+/u, '').trim()
    if (rest)
      cleaned = rest
  }

  const minLen = input.minLength ?? 60
  const maxLen = input.maxLength ?? 155
  const chars = Array.from(cleaned)
  const needsTruncate = chars.length > maxLen || preTruncatedExcerpt
  let effectiveUpper = Math.min(chars.length, maxLen)

  // 若有效窗口内存在未闭合的成对左引号：若左引号位于 minLen 之后，优先将截断上限收束到该左引号之前
  const unclosedIdx = findFirstUnclosedQuoteIndex(chars, effectiveUpper)
  if (unclosedIdx >= minLen) {
    effectiveUpper = unclosedIdx
  }

  const stripUnclosedQuotes = (str: string): string => {
    const arr = Array.from(str)
    for (const [open, close] of QUOTE_PAIRS) {
      const stack: number[] = []
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] === open)
          stack.push(i)
        else if (arr[i] === close && stack.length > 0)
          stack.pop()
      }
      for (let j = stack.length - 1; j >= 0; j--)
        arr.splice(stack[j], 1)
    }
    return arr.join('').replace(TRAILING_DANGLING_RE, '').trim()
  }

  const findLastSentenceEnd = (limit: number): number => {
    let best = -1
    const floor = Math.max(24, Math.min(minLen - 1, Math.floor(limit * 0.55)))
    for (let i = floor; i < limit; i++) {
      const ch = chars[i]
      const isAsciiPeriod = ch === '.'
        && (i + 1 >= chars.length || /\s/.test(chars[i + 1]))
        && !(i > 0 && /\d/.test(chars[i - 1]) && i + 1 < chars.length && /\d/.test(chars[i + 1]))
      if (SENTENCE_END_CHARS.has(ch) || isAsciiPeriod) {
        let end = i
        while (end + 1 < limit && CLOSING_PAIR_CHARS.has(chars[end + 1]))
          end++
        best = end
      }
    }
    return best
  }

  if (!needsTruncate && unclosedIdx < 0)
    return cleaned.replace(TRAILING_DANGLING_RE, '').trim()

  // 1. 优先在 [minLen, effectiveUpper) 区间内寻找最后一个完整句末标点
  const bestSentenceEnd = findLastSentenceEnd(effectiveUpper)
  if (bestSentenceEnd >= 0)
    return stripUnclosedQuotes(chars.slice(0, bestSentenceEnd + 1).join(''))

  if (!needsTruncate)
    return stripUnclosedQuotes(chars.slice(0, effectiveUpper).join(''))

  // 2. 次选在后段分句标点（逗号、顿号、分号等）处收尾并补省略号
  const clauseFloor = Math.max(minLen, Math.floor(effectiveUpper * 0.65))
  for (let i = effectiveUpper - 1; i >= clauseFloor; i--) {
    if (CLAUSE_BREAK_CHARS.has(chars[i])) {
      const head = stripUnclosedQuotes(chars.slice(0, i).join(''))
      if (head)
        return `${head}…`
    }
  }

  // 3. 兜底截断：避免劈开英文单词，并剥离未闭合左引号与末尾悬空标点
  let cut = Math.min(effectiveUpper, maxLen - 1)
  if (cut < chars.length && /[a-z0-9]/i.test(chars[cut - 1] ?? '') && /[a-z0-9]/i.test(chars[cut] ?? '')) {
    let spaceIdx = cut - 1
    while (spaceIdx > minLen && !/\s/.test(chars[spaceIdx]))
      spaceIdx--
    if (spaceIdx > minLen)
      cut = spaceIdx
  }
  const truncated = stripUnclosedQuotes(chars.slice(0, cut).join(''))
  return truncated ? `${truncated}…` : ''
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

function sanitizeRobotsPath(value: string): string {
  const clean = value.replace(/[\r\n\t]/g, '').trim()
  if (!clean)
    return ''
  if (clean.startsWith('/') || clean.startsWith('*'))
    return clean
  return `/${clean}`
}

/**
 * 解析后台配置的额外 robots.txt 规则文本：
 * - 支持多段 `User-agent:` 分组及组内的 `Allow:` / `Disallow:` / `Crawl-delay:` / `Sitemap:`
 * - 未先声明 `User-agent:` 的顶层 `Allow:` / `Disallow:` 自动并入默认 `*` 规则之后
 * - 剥离 `#` 注释与非法换行控制字符，自动补齐路径前导 `/` 防止语法校验报错
 */
export function parseExtraRobotsRules(raw?: string | null): {
  rootAllow: string[]
  rootDisallow: string[]
  rootCrawlDelay?: number
  extraSitemaps: string[]
  groups: RobotsRuleGroup[]
} {
  const rootAllow: string[] = []
  const rootDisallow: string[] = []
  const extraSitemaps: string[] = []
  let rootCrawlDelay: number | undefined
  const groups: RobotsRuleGroup[] = []

  if (!raw?.trim())
    return { rootAllow, rootDisallow, extraSitemaps, groups }

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

    if (directive === 'sitemap') {
      if (/^https?:\/\/\S+$/i.test(value))
        extraSitemaps.push(value)
      continue
    }

    if (directive === 'allow') {
      const pathVal = sanitizeRobotsPath(value)
      if (!pathVal)
        continue
      if (currentAgents.length === 0) {
        rootAllow.push(pathVal)
      }
      else {
        inRuleBody = true
        currentAllow.push(pathVal)
      }
    }
    else if (directive === 'disallow') {
      if (!value) {
        if (currentAgents.length > 0) {
          inRuleBody = true
          currentDisallow.push('')
        }
        continue
      }
      const pathVal = sanitizeRobotsPath(value)
      if (currentAgents.length === 0) {
        rootDisallow.push(pathVal)
      }
      else {
        inRuleBody = true
        currentDisallow.push(pathVal)
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

  return { rootAllow, rootDisallow, rootCrawlDelay, extraSitemaps, groups }
}

export interface RobotsTxtConfigInput {
  baseUrl?: string | null
  allowIndexing?: boolean
  sitemapEnabled?: boolean
  robotsExtraRules?: string | null
}

/**
 * 生成符合 RFC 9309 与 Lighthouse SEO 校验规范的纯文本 robots.txt
 */
export function buildRobotsTxtContent(input: RobotsTxtConfigInput): string {
  if (input.allowIndexing === false) {
    return 'User-agent: *\nDisallow: /\n'
  }

  const extra = parseExtraRobotsRules(input.robotsExtraRules)
  const defaultAllow = Array.from(new Set(['/', '/_next/', ...extra.rootAllow]))
  const defaultDisallow = Array.from(new Set([
    '/console/',
    '/auth/',
    ...routing.locales.filter(locale => locale !== routing.defaultLocale).map(locale => `${LOCALE_PREFIXES[locale]}/auth/`),
    // 屏蔽无独立内容的遗留/搜索/追踪动态参数，避免消耗搜索引擎抓取配额（保留 /?label= 等供链接跟踪并由 X-Robots-Tag 收敛）
    '/*?p=',
    '/*&p=',
    '/*?query=',
    '/*&query=',
    '/*?source=',
    '/*&source=',
    '/*?from=',
    '/*&from=',
    '/*?utm_',
    '/*&utm_',
    '/*?comment=',
    '/*&comment=',
    ...extra.rootDisallow,
  ]))

  const blocks: string[] = []
  const rootLines = ['User-agent: *']
  for (const p of defaultAllow)
    rootLines.push(`Allow: ${p}`)
  for (const p of defaultDisallow)
    rootLines.push(`Disallow: ${p}`)
  if (extra.rootCrawlDelay !== undefined)
    rootLines.push(`Crawl-delay: ${extra.rootCrawlDelay}`)
  blocks.push(rootLines.join('\n'))

  for (const group of extra.groups) {
    const lines: string[] = []
    const agents = Array.isArray(group.userAgent) ? group.userAgent : [group.userAgent]
    for (const agent of agents)
      lines.push(`User-agent: ${agent}`)
    const allows = group.allow ? (Array.isArray(group.allow) ? group.allow : [group.allow]) : []
    for (const p of allows)
      lines.push(`Allow: ${p}`)
    const disallows = group.disallow ? (Array.isArray(group.disallow) ? group.disallow : [group.disallow]) : []
    for (const p of disallows)
      lines.push(`Disallow: ${p}`)
    if (group.crawlDelay !== undefined)
      lines.push(`Crawl-delay: ${group.crawlDelay}`)
    blocks.push(lines.join('\n'))
  }

  const sitemaps = new Set<string>()
  const baseUrl = input.baseUrl?.trim().replace(/\/+$/, '') ?? ''
  if ((input.sitemapEnabled ?? true) && /^https?:\/\/\S+$/i.test(baseUrl))
    sitemaps.add(`${baseUrl}/sitemap.xml`)
  for (const sm of extra.extraSitemaps)
    sitemaps.add(sm)

  if (sitemaps.size > 0)
    blocks.push(Array.from(sitemaps, url => `Sitemap: ${url}`).join('\n'))

  return `${blocks.join('\n\n')}\n`
}
