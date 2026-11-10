import type { Metadata } from 'next'
import type { Article, WithContext } from 'schema-dts'
import { getLocale } from 'next-intl/server'
import { getCachedSiteInfo } from '@/api/misc.server'
import { localeAlternates } from '@/i18n/alternates'
import { localizePath } from '@/i18n/routing'
import { stripInlineMarkdown } from '@/utils/common/inline-markdown'
import { getPostShareImageUrl, getPostUrl, getUserUrl } from '@/utils/common/route'
import { safeMetadataBase } from '@/utils/common/siteinfo'
import { formatDisplayName as formatFullName } from '@/utils/common/username'
import { BlogPost } from './blog-post'
import { getCanonicalPost } from './post-data'

// 这个是app router固定的传入格式，无法更改
interface Props {
  params: Promise<{ id: string }>
}

// 文章页按 ISR 缓存：构建时不预渲染（返回空数组），每篇文章（每种语言）在第一次被访问时生成，之后文档请求与预取都直接用缓存。
// 后台修改文章 / 分类 / 标签、站点配置后，posts / site 标签失效（见 lib/cache-tags.ts），下次访问重新生成；
// slug 跳转（308，在 layout 判定）同样被缓存，改 slug 时一并失效；不存在的文章（404）不缓存，每次向后端确认。
// revalidate 只是标签失效没送到时的兜底（根布局为 30 秒，取两者中较小的）；浏览量、点赞数是快照，浏览器进入页面后另取最新值
export const revalidate = 60

export function generateStaticParams() {
  return []
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  // 与 layout、页面共用同一次文章请求（post-data.ts 的 React cache）；浏览量由前台访问上报计数，与此无关
  // 文章与站点信息并行取（站点信息已跨请求缓存）；locale 与它们也互不依赖。404 与 slug 跳转已在 layout 判定，这里只是同样的兜底
  const [post, siteInfo, locale] = await Promise.all([getCanonicalPost(id), getCachedSiteInfo(), getLocale()])
  // 分享图上的文字跟随页面语言
  const shareImage = localizePath(getPostShareImageUrl(post), locale)
  return {
    title: post.title || 'No Title',
    description: stripInlineMarkdown(post.description) || post.content.slice(0, 160) || post.title || 'No Description',
    metadataBase: safeMetadataBase(siteInfo?.baseUrl),
    alternates: localeAlternates(getPostUrl({ post }), locale),
    authors: post.user ? [{ name: formatFullName(post.user) }] : undefined,
    creator: post.user ? formatFullName(post.user) : undefined,
    keywords: post.labels?.map(label => label.name) || undefined,
    openGraph: {
      title: post.title || 'No Title',
      description:
        stripInlineMarkdown(post.description) || post.content.slice(0, 160) || post.title || 'No Description',
      url: localizePath(getPostUrl({ post }), locale),
      siteName: siteInfo?.metadata.name || 'Site Name',
      // 分享图由 /p/{id}/share-image 生成，不直接用封面：社交平台上的卡片信息更完整
      images: [{ url: shareImage, width: 1080, height: 1350, alt: post.title || 'No Title' }],
      // Open Graph 的 locale 写法为 language_TERRITORY，如 zh_TW
      locale: locale.replace('-', '_'),
      type: 'article',
    },
    twitter: {
      // 分享图是竖版卡片，用 summary 卡片避免被裁成横图
      card: 'summary',
      title: post.title || 'No Title',
      description: stripInlineMarkdown(post.description) || post.content.slice(0, 160) || post.title || 'No Description',
      images: [shareImage],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        'index': true,
        'follow': true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  }
}

export default async function PostPage({ params }: Props) {
  const { id } = await params
  // 404 与 slug 跳转在 layout 判定（见 layout.tsx），这里拿到的一定是规范地址上的公开文章
  const [post, siteInfo, locale] = await Promise.all([getCanonicalPost(id), getCachedSiteInfo(), getLocale()])

  const jsonLd: WithContext<Article> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': post.title,
    'author': {
      '@type': 'Person',
      'name': formatFullName(post.user),
      'url': `${siteInfo.baseUrl}${localizePath(getUserUrl({ username: post.user.username }), locale)}`,
    },
    // 没有封面时省略 image；站内相对路径要补成绝对地址（结构化数据不接受相对 URL）
    ...(post.cover
      ? { image: post.cover.startsWith('http') ? post.cover : `${siteInfo.baseUrl}${post.cover}` }
      : {}),
    'datePublished': post.createdAt,
    'dateModified': post.updatedAt,
    'publisher': {
      '@type': 'Organization',
      'name': siteInfo?.metadata.name || 'Site Name',
      'logo': {
        '@type': 'ImageObject',
        'url': siteInfo?.metadata.icon || 'favicon.ico',
      },
    },
    'description': stripInlineMarkdown(post.description) || post.content.slice(0, 160) || post.title,
    // mainEntityOfPage 指向文章自身，而不是站点根地址
    'mainEntityOfPage': {
      '@type': 'WebPage',
      '@id': `${siteInfo.baseUrl}${localizePath(getPostUrl({ post }), locale)}`,
    },
  }

  return (
    <div className="flex flex-col h-100vh">
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
