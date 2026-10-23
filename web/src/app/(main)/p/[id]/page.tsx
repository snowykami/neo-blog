import type { Metadata } from 'next'
import type { Article, WithContext } from 'schema-dts'
import { getLocale } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import Script from 'next/script'
import { cache } from 'react'
import { getCachedSiteInfo } from '@/api/misc.server'
import { getPostByIdServer } from '@/api/post.server'
import { isNotFoundLikeError } from '@/utils/common/error'
import { stripInlineMarkdown } from '@/utils/common/inline-markdown'
import { getPostUrl, getUserUrl } from '@/utils/common/route'
import { getDefaultCoverRandomly, safeMetadataBase } from '@/utils/common/siteinfo'
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
  const locale = (await getLocale()) || 'en'
  const siteInfo = await getCachedSiteInfo()
  if (!post) {
    return {
      title: 'Post Not Found',
      description: 'The post you are looking for does not exist.',
    }
  }
  return {
    title: post.title || 'No Title',
    description: stripInlineMarkdown(post.description) || post.content.slice(0, 160) || post.title || 'No Description',
    metadataBase: safeMetadataBase(siteInfo?.baseUrl),
    alternates: { canonical: post ? getPostUrl({ post }) : undefined },
    authors: post.user ? [{ name: formatFullName(post.user) }] : undefined,
    creator: post.user ? formatFullName(post.user) : undefined,
    keywords: post.labels?.map(label => label.name) || undefined,
    openGraph: {
      title: post.title || 'No Title',
      description:
        stripInlineMarkdown(post.description) || post.content.slice(0, 160) || post.title || 'No Description',
      url: getPostUrl({ post }),
      siteName: siteInfo?.metadata.name || 'Site Name',
      images: [
        {
          url: post.cover || getDefaultCoverRandomly(siteInfo),
          width: 800,
          height: 600,
          alt: post?.title || 'No Title',
        },
      ],
      locale,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title || 'No Title',
      description: stripInlineMarkdown(post.description) || post.content.slice(0, 160) || post.title || 'No Description',
      images: [post.cover || getDefaultCoverRandomly(siteInfo)],
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

export default async function PostPage({ params, searchParams }: Props) {
  const { id } = await params
  const { type } = await searchParams
  const post = await getCachedPost(id, type)
  const siteInfo = await getCachedSiteInfo()
  if (!post)
    return notFound()
  // 如果当前访问的 id 不是 post 的 slug，则重定向到正确的 URL
  if (post.slug && post.slug !== id) {
    redirect(getPostUrl({ post, type }))
  }

  const jsonLd: WithContext<Article> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': post.title,
    'author': {
      '@type': 'Person',
      'name': formatFullName(post.user),
      'url': `${siteInfo.baseUrl}/${getUserUrl({ username: post.user.username })}`,
    },
    'image': post.cover || '',
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
    'mainEntityOfPage': {
      '@type': 'WebPage',
      '@id': siteInfo?.baseUrl || '',
    },
  }

  return (
    <div className="flex flex-col h-100vh">
      <BlogPost post={post} isDraft={type === 'draft'} />
      <Script
        id="json-ld"
        type="application/ld+json"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
    </div>
  )
}
