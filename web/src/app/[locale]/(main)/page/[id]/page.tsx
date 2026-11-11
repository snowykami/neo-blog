import type { Metadata } from 'next'
import type { PageModel } from '@/models/page'
import { getLocale } from 'next-intl/server'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getPageById } from '@/api/page'
import { localeAlternates } from '@/i18n/alternates'
import { BUILD_PLACEHOLDER_PARAM, CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
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

// 页面按地址缓存：构建时只预渲染占位参数（见 lib/cache-tags.ts 的 BUILD_PLACEHOLDER_PARAM），每个页面在第一次被访问时生成，
// 后台修改页面后 pages 标签失效、下次访问重新生成；404 与链接页的跳转（307）在生成过程中判定（loading.tsx 的骨架里面，见 p/[id]/post-data.ts 的说明）
export function generateStaticParams() {
  return [{ id: BUILD_PLACEHOLDER_PARAM }]
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const [page, locale] = await Promise.all([getCachedPage(id).catch(() => null), getLocale()])
  if (!page)
    return {}
  return {
    title: page.title,
    description: page.description,
    alternates: localeAlternates(getPageUrl(page), locale),
    openGraph: page.cover ? { title: page.title, description: page.description, images: [page.cover] } : undefined,
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const page = await getCachedPage(id)
  if (!page)
    notFound()
  return <PageView page={page} />
}
