import type { Metadata } from 'next'
import type { Article, WithContext } from 'schema-dts'
import { getLocale } from 'next-intl/server'
import { notFound, permanentRedirect } from 'next/navigation'
import { cache } from 'react'
import { getCachedSiteInfo } from '@/api/misc.server'
import { getPostByIdServer } from '@/api/post.server'
import { isNotFoundLikeError } from '@/utils/common/error'
import { stripInlineMarkdown } from '@/utils/common/inline-markdown'
import { getPostShareImageUrl, getPostUrl, getUserUrl } from '@/utils/common/route'
import { safeMetadataBase } from '@/utils/common/siteinfo'
import { formatDisplayName as formatFullName } from '@/utils/common/username'
import { BlogPost } from './blog-post'

// Cache the post fetch to avoid duplicate requests during SSR
const getCachedPost = cache(async (id: string, type?: 'draft' | undefined) => {
  return getPostByIdServer({ id, type })
    .then(res => res.data)
    .catch((error) => {
      // 仅在后端明确表示不存在 / 无权查看 / 参数非法时视为 404，其余错误交给错误边界，避免把 500、超时显示成 404
      if (isNotFoundLikeError(error))
        return null
      throw error
    })
})

// 这个是app router固定的传入格式，无法更改
interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ type: 'draft' | undefined }>
}

// Enable ISR with 60 seconds revalidation for better performance
export const revalidate = 60

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params
  // 参数需与页面中的调用完全一致，才能命中 React cache，避免重复请求；浏览量由前台访问上报计数，与此无关
  const { type } = await searchParams
  const post = await getCachedPost(id, type)
  // 元信息在流式渲染开始前解析完成，404 与永久重定向必须在这里判定：
  // 页面里有 loading.tsx，外壳一旦流出，页面内再 notFound() / redirect() 就只能返回 200，对爬虫是软 404
  if (!post)
    notFound()
  if (post.slug && post.slug !== id)
    permanentRedirect(getPostUrl({ post, type }))
  const locale = (await getLocale()) || 'en'
  const siteInfo = await getCachedSiteInfo()
  const shareImage = getPostShareImageUrl(post)
  return {
    title: post.title || 'No Title',
    description: stripInlineMarkdown(post.description) || post.content.slice(0, 160) || post.title || 'No Description',
    metadataBase: safeMetadataBase(siteInfo?.baseUrl),
    alternates: { canonical: getPostUrl({ post }) },
    authors: post.user ? [{ name: formatFullName(post.user) }] : undefined,
    creator: post.user ? formatFullName(post.user) : undefined,
    keywords: post.labels?.map(label => label.name) || undefined,
    openGraph: {
      title: post.title || 'No Title',
      description:
        stripInlineMarkdown(post.description) || post.content.slice(0, 160) || post.title || 'No Description',
      url: getPostUrl({ post }),
      siteName: siteInfo?.metadata.name || 'Site Name',
      // 分享图由 /p/{id}/share-image 生成，不直接用封面：社交平台上的卡片信息更完整
      images: [{ url: shareImage, width: 1080, height: 1350, alt: post.title || 'No Title' }],
      locale,
      type: 'article',
    },
    twitter: {
      // 分享图是竖版卡片，用 summary 卡片避免被裁成横图
      card: 'summary',
      title: post.title || 'No Title',
      description: stripInlineMarkdown(post.description) || post.content.slice(0, 160) || post.title || 'No Description',
      images: [shareImage],
    },
    robots: type === 'draft'
      ? { index: false, follow: false }
      : {
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

export default async function PostPage({ params, searchParams }: Props) {
  const { id } = await params
  const { type } = await searchParams
  const post = await getCachedPost(id, type)
  const siteInfo = await getCachedSiteInfo()
  if (!post)
    return notFound()
  // 如果当前访问的 id 不是 post 的 slug，则永久重定向到正确的 URL（metadata 中已处理，这里兜底）
  if (post.slug && post.slug !== id) {
    permanentRedirect(getPostUrl({ post, type }))
  }

  const jsonLd: WithContext<Article> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': post.title,
    'author': {
      '@type': 'Person',
      'name': formatFullName(post.user),
      'url': `${siteInfo.baseUrl}${getUserUrl({ username: post.user.username })}`,
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
      '@id': `${siteInfo.baseUrl}${getPostUrl({ post })}`,
    },
  }

  return (
    <div className="flex flex-col h-100vh">
      <BlogPost post={post} isDraft={type === 'draft'} />
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
