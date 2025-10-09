import type { Metadata } from 'next'
import type { WebSite, WithContext } from 'schema-dts'
import { getLocale, getTranslations } from 'next-intl/server'
import Script from 'next/script'
import { getSiteInfo } from '@/api/misc'
import BlogHome from '@/components/blog-home/blog-home'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'

export async function generateMetadata(): Promise<Metadata> {
  const siteInfo = await getSiteInfo()
    .then(res => res.data)
    .catch(() => fallbackSiteInfo)
  const routeT = await getTranslations('Route')
  const locale = (await getLocale()) || 'zh-CN'
  return {
    title: routeT('homepage'),
    description: siteInfo.metadata.description,
    metadataBase: new URL(siteInfo.baseUrl || ''),
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

export default async function Page() {
  const siteInfo = await getSiteInfo()
    .then(res => res.data)
    .catch(() => fallbackSiteInfo)
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
      'target': `${siteInfo.baseUrl}/?keywords={search_term_string}`,
      'query': 'required name=search_term_string',
    },
  }
  return (
    <>
      <BlogHome />
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
