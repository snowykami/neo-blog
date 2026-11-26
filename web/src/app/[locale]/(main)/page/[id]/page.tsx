import type { Metadata } from 'next'
import type { PageModel } from '@/models/page'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getCachedSiteInfo } from '@/api/misc.server'
import { getPageById } from '@/api/page'
import { resolveRouteLocale, routing } from '@/i18n/routing'
import { BUILD_PLACEHOLDER_PARAM, CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { buildContentMetaDescription, buildPublicPageMetadata } from '@/lib/seo'
import { isNotFoundLikeError } from '@/utils/common/error'
import { getPageUrl } from '@/utils/common/route'
import { PageView } from './page-view'

// 跨请求缓存（按 id / slug 分条，各语言共用）：页面按地址缓存，按链接预取与重新生成先读这里；页面增删改时 pages 标签失效。
// 取数不带登录身份（'use cache' 里也读不到 Cookie），私密页面对所有人 404，作者在后台预览（/console/pages/preview/[id]）里看。
// 仅明确不存在 / 私密时返回 null（不缓存，见 CacheTag.NoStore），其余错误交给错误边界、同样不进缓存
async function loadPage(id: string): Promise<PageModel | null> {
  'use cache'
  cacheLife('detail')
  cacheTag(CacheTag.Pages)
  try {
    return (await getPageById({ id })).data
  }
  catch (error) {
    if (!isNotFoundLikeError(error))
      throw error
    cacheTag(CacheTag.NoStore)
    return null
  }
}

// 同一次渲染内 generateMetadata 与页面共用一次读取
const getCachedPage = cache((id: string) => {
  skipBackendAtBuild()
  return loadPage(id)
})

async function getExistingPage(id: string): Promise<PageModel> {
  const page = await getCachedPage(id)
  if (!page)
    notFound()
  return page
}

// 页面按地址缓存：构建时只预渲染占位参数（见 lib/cache-tags.ts 的 BUILD_PLACEHOLDER_PARAM），每个页面在第一次被访问时直出生成进 <main>，
// 后台修改页面后 pages 标签失效、下次访问重新生成；显式关闭 instant 段校验避免开发态警告
export const ensureStatic = 'navigation'
export const instant = false

export function generateStaticParams() {
  return [{ id: BUILD_PLACEHOLDER_PARAM }]
}

function pageMetaDescription(page: PageModel): string {
  return buildContentMetaDescription({
    description: page.description,
    contentHtml: page.content,
    title: page.title,
  })
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string, id: string }>
}): Promise<Metadata> {
  const { locale: rawLocale, id } = await params
  const locale = resolveRouteLocale(rawLocale)
  setRequestLocale(locale)
  const [page, siteInfo, t] = await Promise.all([
    getExistingPage(id),
    getCachedSiteInfo(),
    getTranslations('Common'),
  ])
  const title = page.title || t('untitled')
  const description = pageMetaDescription(page) || title
  const localeMode = siteInfo.seo?.localeIndexMode ?? 'canonical_default'
  return buildPublicPageMetadata({
    locale,
    pathname: getPageUrl(page),
    siteInfo,
    title,
    description,
    image: page.cover || undefined,
    ogType: 'article',
    richRobots: true,
    forceNoIndex: locale !== routing.defaultLocale && localeMode !== 'independent',
  })
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string, id: string }>
}) {
  const { locale: rawLocale, id } = await params
  const locale = resolveRouteLocale(rawLocale)
  setRequestLocale(locale)
  const page = await getExistingPage(id)
  return <PageView page={page} locale={locale} />
}
