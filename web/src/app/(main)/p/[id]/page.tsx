import { redirect } from 'next/navigation'
import { BlogPost } from '@/components/blog-post/blog-post'
import { Metadata } from 'next'
import { getPostByIdServer } from '@/api/post.server'
import { getPostUrl } from '@/utils/common/route'
import { notFound } from "next/navigation";
import { getSiteInfo } from '@/api/misc'
import { fallbackSiteInfo, getDefaultCoverRandomly } from '@/utils/common/siteinfo'
import { formatDisplayName as formatFullName } from '@/utils/common/username'
import { Article, WithContext } from 'schema-dts'
import { getLocale } from 'next-intl/server'
import Script from 'next/script'

// 这个是app router固定的传入格式，无法更改
interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ type: 'draft' | undefined }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const post = await getPostByIdServer({ id }).then(res => res.data).catch(() => null);
  const locale = await getLocale() || 'en';
  const siteInfo = await getSiteInfo().then(res => res.data).catch(() => fallbackSiteInfo);
  if (!post) {
    return {
      title: 'Post Not Found',
      description: 'The post you are looking for does not exist.',
    }
  }
  return {
    title: post.title || 'No Title',
    description: post.description || post.content.slice(0, 160) || post.title || 'No Description',
    metadataBase: new URL(siteInfo?.baseUrl || ''),
    alternates: { canonical: post ? getPostUrl({ post }) : undefined },
    authors: post.user ? [{ name: formatFullName(post.user) }] : undefined,
    creator: post.user ? formatFullName(post.user) : undefined,
    keywords: post.labels?.map(label => label.name) || undefined,
    openGraph: {
      title: post.title || 'No Title',
      description: post?.description || post.content.slice(0, 160) || post.title || 'No Description',
      url: getPostUrl({ post }),
      siteName: siteInfo?.metadata.name || 'Site Name',
      images: [
        {
          url: post.cover || getDefaultCoverRandomly(siteInfo),
          width: 800,
          height: 600,
          alt: post?.title || 'No Title',
        }
      ],
      locale: locale,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title || 'No Title',
      description: post.description || post.content.slice(0, 160) || post.title || 'No Description',
      images: [post.cover || getDefaultCoverRandomly(siteInfo)],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      }
    }
  };
}


export default async function PostPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { type } = await searchParams;
  const post = await getPostByIdServer({ id, type }).then(res => res.data).catch(() => null);
  const siteInfo = await getSiteInfo().then(res => res.data).catch(() => fallbackSiteInfo);
  if (!post) return notFound();
  // 如果当前访问的 id 不是 post 的 slug，则重定向到正确的 URL
  if (post.slug && post.slug !== id) {
    redirect(getPostUrl({ post, type }));
  }

  const jsonld: WithContext<Article> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    author: {
      "@type": "Person",
      name: formatFullName(post.user)
    },
    image: post.cover || '',
    datePublished: post.createdAt,
    dateModified: post.updatedAt,
    publisher: {
      "@type": "Organization",
      name: siteInfo?.metadata.name || "Site Name",
      logo: {
        "@type": "ImageObject",
        url: siteInfo?.metadata.icon || 'favicon.ico'
      }
    },
    description: post.description || post.content.slice(0, 160) || post.title,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": siteInfo?.baseUrl || ""
    },
  }

  return (
    <div className="flex flex-col h-100vh">
      <BlogPost post={post} isDraft={type === 'draft'} />
      <Script
        id="json-ld"
        type="application/ld+json"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld).replace(/</g, '\\u003c') }}
      />
    </div>
  )
}
