import type { Metadata } from 'next'
import type { Article, WithContext } from 'schema-dts'
import type { Post } from '@/models/post'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getCachedSiteInfo } from '@/api/misc.server'
import { localeAlternates } from '@/i18n/alternates'
import { localizePath, resolveRouteLocale, routing } from '@/i18n/routing'
import { BUILD_PLACEHOLDER_PARAM } from '@/lib/cache-tags'
import { buildContentMetaDescription, buildSeoRobots, normalizeTwitterHandle, resolveDefaultOgImage } from '@/lib/seo'
import { getPostShareImageUrl, getPostUrl, getUserUrl } from '@/utils/common/route'
import { absoluteSiteUrl, safeMetadataBase } from '@/utils/common/siteinfo'
import { formatDisplayName as formatFullName } from '@/utils/common/username'
import { BlogPost } from './blog-post'
import { getCanonicalPost } from './post-data'

// metaDescription 页面描述（meta / Open Graph / 结构化数据）：作者填写的描述优先，其次从正文纯文本智能提取（句末自然收尾，避免截断在半个引号或标题前缀）
function metaDescription(post: Post): string {
  return buildContentMetaDescription({
    description: post.description,
    excerpt: post.excerpt,
    contentHtml: post.content,
    title: post.title,
  })
}

// 这个是app router固定的传入格式，无法更改
interface Props {
  params: Promise<{ locale: string, id: string }>
}

// 文章页按地址缓存：构建时只预渲染占位参数（见 lib/cache-tags.ts 的 BUILD_PLACEHOLDER_PARAM），每篇文章（每种语言）在第一次被访问时
// 整页直接生成进 <main>，之后文档请求与悬停时的按链接预取（dynamicOnHover）都直接命中缓存。后台修改文章 / 分类 / 标签、站点配置后，
// posts / site 标签失效（见 lib/cache-tags.ts），下次访问重新生成；slug 跳转（308）同样被缓存，不存在的文章（404）不缓存。
// 显式关闭段级 instant 导航校验，避免开发态因移除外层 loading.tsx 弹出 params 阻塞警告
export const ensureStatic = 'navigation'
export const instant = false

export function generateStaticParams() {
  return [{ id: BUILD_PLACEHOLDER_PARAM }]
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: rawLocale, id } = await params
  const locale = resolveRouteLocale(rawLocale)
  setRequestLocale(locale)
  // 与页面共用同一次文章读取（post-data.ts 的 React cache）；浏览量由前台访问上报计数，与此无关
  // 文章与站点信息并行取（都已跨请求缓存）；设置请求级 locale 避免触发 headers()。404 与 slug 跳转与页面同样判定
  const [post, siteInfo, t] = await Promise.all([
    getCanonicalPost(id, locale),
    getCachedSiteInfo(),
    getTranslations('Common'),
  ])
  // 分享图上的文字跟随页面语言
  const shareImage = localizePath(getPostShareImageUrl(post), locale)
  // 标题为空时用「无标题」；描述依次取作者描述、正文摘要、标题；站点名为空时不输出
  const title = post.title || t('untitled')
  const description = metaDescription(post) || title
  const siteName = siteInfo?.metadata.name || undefined
  const twitterHandle = normalizeTwitterHandle(siteInfo?.seo?.twitterHandle)
  const localeMode = siteInfo?.seo?.localeIndexMode ?? 'canonical_default'
  const canonicalPath = localizePath(
    getPostUrl({ post }),
    localeMode === 'independent' ? locale : routing.defaultLocale,
  )
  const postKeywords = post.labels?.length
    ? post.labels.map(label => label.name)
    : (siteInfo?.keywords?.length ? siteInfo.keywords : undefined)
  return {
    title,
    description,
    metadataBase: safeMetadataBase(siteInfo?.baseUrl),
    alternates: localeAlternates(
      getPostUrl({ post }),
      locale,
      localeMode,
      siteInfo?.seo?.rssEnabled ?? true,
    ),
    authors: post.user ? [{ name: formatFullName(post.user) }] : undefined,
    creator: post.user ? formatFullName(post.user) : undefined,
    keywords: postKeywords,
    openGraph: {
      title,
      description,
      url: canonicalPath,
      siteName,
      // 分享图由 /p/{id}/share-image 生成，不直接用封面：社交平台上的卡片信息更完整
      images: [{ url: shareImage, width: 1080, height: 1350, alt: title }],
      // Open Graph 的 locale 写法为 language_TERRITORY，如 zh_TW
      locale: locale.replace('-', '_'),
      type: 'article',
    },
    twitter: {
      // 分享图是竖版卡片，用 summary 卡片避免被裁成横图
      card: 'summary',
      title,
      description,
      images: [shareImage],
      ...(twitterHandle ? { site: twitterHandle, creator: twitterHandle } : {}),
    },
    robots: (locale !== routing.defaultLocale && localeMode !== 'independent')
      ? (siteInfo?.seo?.allowIndexing === false
          ? { index: false, follow: false, googleBot: { index: false, follow: false } }
          : { index: false, follow: true, googleBot: { index: false, follow: true } })
      : buildSeoRobots(locale, siteInfo, true),
  }
}

export default async function PostPage({ params }: Props) {
  const { locale: rawLocale, id } = await params
  const locale = resolveRouteLocale(rawLocale)
  setRequestLocale(locale)
  // 不存在 → 404，用 id 访问有 slug 的文章 → 308（见 post-data.ts）；之后拿到的一定是规范地址上的公开文章
  const [post, siteInfo] = await Promise.all([getCanonicalPost(id, locale), getCachedSiteInfo()])
  const localeMode = siteInfo?.seo?.localeIndexMode ?? 'canonical_default'
  const canonicalLocale = localeMode === 'independent' ? locale : routing.defaultLocale
  const articleImage = post.cover?.trim()
    || resolveDefaultOgImage(siteInfo)
    || localizePath(getPostShareImageUrl(post), canonicalLocale)

  const jsonLd: WithContext<Article> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': post.title,
    'author': {
      '@type': 'Person',
      'name': formatFullName(post.user),
      'url': absoluteSiteUrl(localizePath(getUserUrl({ username: post.user.username }), canonicalLocale), siteInfo.baseUrl),
    },
    // Google Rich Results 要求 Article 提供有效绝对图片 URL：依次取文章封面 -> 站点默认 OG 图 / 站点图标 -> 文章动态分享图
    'image': absoluteSiteUrl(articleImage, siteInfo.baseUrl),
    'datePublished': post.createdAt,
    'dateModified': post.updatedAt,
    'publisher': {
      '@type': 'Organization',
      'name': siteInfo?.metadata.name || undefined,
      'logo': {
        '@type': 'ImageObject',
        'url': absoluteSiteUrl(siteInfo?.metadata.icon || '/favicon.ico', siteInfo.baseUrl),
      },
    },
    'description': metaDescription(post) || post.title,
    // mainEntityOfPage 与规范地址保持一致
    'mainEntityOfPage': {
      '@type': 'WebPage',
      '@id': absoluteSiteUrl(localizePath(getPostUrl({ post }), canonicalLocale), siteInfo.baseUrl),
    },
  }

  return (
    <div className="flex flex-col">
      <BlogPost post={post} />
      {/* 结构化数据必须直接出现在 SSR 的 HTML 里：用 next/script 只会进 __next_s 队列，需执行 JS 才注入 */}
      <script
        id="json-ld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
    </div>
  )
}
