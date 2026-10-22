import type { Metadata } from 'next'
import type { WebSite, WithContext } from 'schema-dts'
import type { BlogHomeInitialData } from './blog-home-query'
import { getLocale, getTranslations } from 'next-intl/server'
import Script from 'next/script'
import { getCachedSiteInfo } from '@/api/misc.server'
import { listPostsServer } from '@/api/post.server'
import { OrderBy } from '@/models/common'
import { safeMetadataBase } from '@/utils/common/siteinfo'
import BlogHome from './blog-home'
import { blogHomeQueryKey } from './blog-home-query'

// Enable ISR with 60 seconds revalidation for home page
export const revalidate = 60

export async function generateMetadata(): Promise<Metadata> {
  const siteInfo = await getCachedSiteInfo()
  const routeT = await getTranslations('Route')
  const locale = (await getLocale()) || 'zh-CN'
  return {
    title: routeT('homepage'),
    description: siteInfo.metadata.description,
    metadataBase: safeMetadataBase(siteInfo?.baseUrl),
    icons: [{ rel: 'icon', url: siteInfo.metadata.icon }],
    keywords: siteInfo.keywords,
    openGraph: {
      title: `${routeT('homepage')} - ${siteInfo.metadata.name}`,
      description: siteInfo.metadata.description,
      url: siteInfo?.baseUrl || '',
      siteName: siteInfo?.metadata.name || 'Site Name',
      images: [
        {
          url: siteInfo?.metadata.icon || '',
          width: 800,
          height: 600,
          alt: siteInfo?.metadata.name || 'Site Name',
        },
      ],
      locale,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${routeT('homepage')} - ${siteInfo.metadata.name}`,
      description: siteInfo.metadata.description,
      images: [siteInfo.metadata.icon || ''],
    },
    alternates: {
      canonical: siteInfo.baseUrl,
    },
  }
}

// 服务端预取首屏文章（默认按最新排序），客户端参数一致时直接复用
async function getInitialPosts(searchParams: Record<string, string | string[] | undefined>, pageSize: number): Promise<BlogHomeInitialData | undefined> {
  const pick = (key: string) => (typeof searchParams[key] === 'string' ? searchParams[key] as string : undefined)
  const page = Math.max(1, Number.parseInt(pick('page') || '1', 10) || 1)
  const params = { page, label: pick('label'), category: pick('category'), query: pick('query'), orderBy: OrderBy.CreatedAt }
  try {
    const res = await listPostsServer({ ...params, size: pageSize || 9, desc: true })
    return { key: blogHomeQueryKey(params), posts: res.data.posts, total: res.data.total }
  }
  catch {
    return undefined // 预取失败时交给客户端加载
  }
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const siteInfo = await getCachedSiteInfo()
  const initialData = await getInitialPosts(await searchParams, siteInfo.postsPerPage)
  const jsonLd: WithContext<WebSite> = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': siteInfo.metadata.name,
    'url': siteInfo.baseUrl,
    'description': siteInfo.metadata.description,
    'publisher': {
      '@type': 'Organization',
      'name': siteInfo.metadata.name,
      'logo': {
        '@type': 'ImageObject',
        'url': siteInfo.metadata.icon,
      },
    },
    'potentialAction': {
      '@type': 'SearchAction',
      'target': `${siteInfo.baseUrl}/?query={search_term_string}`,
      'query': 'required name=search_term_string',
    },
  }
  return (
    <>
      <BlogHome initialData={initialData} />
      <Script
        id="json-ld"
        type="application/ld+json"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
    </>
  )
}
