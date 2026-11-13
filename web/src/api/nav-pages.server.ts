import type { PageModel } from '@/models/page'
import { cacheLife, cacheTag } from 'next/cache'
import { cache } from 'react'
import { CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { NAV_PAGES_QUERY, toNavPages } from '@/utils/common/nav-pages'
import { listPages } from './page'

/**
 * 顶栏「页面」菜单里的自定义页面：跨请求缓存（与站点信息同档），页面增删改时 pages 标签失效。
 * 随布局一起服务端渲染进顶栏，不再等浏览器水合后另发请求（菜单不会在请求返回后才突然多出一项）
 */
async function loadNavPages(): Promise<PageModel[]> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Pages)
  const res = await listPages(NAV_PAGES_QUERY)
  return toNavPages(res.data.pages)
}

/** 取不到时返回 undefined，由浏览器挂载后自己请求（见 components/layout/nav/nav-pages-context.tsx） */
export const getCachedNavPages = cache(async (): Promise<PageModel[] | undefined> => {
  skipBackendAtBuild()
  return loadNavPages().catch(() => undefined)
})
