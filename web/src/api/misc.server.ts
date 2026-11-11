import type { SiteInfo } from '@/utils/common/siteinfo'
import { cacheLife, cacheTag } from 'next/cache'
import { cache } from 'react'
import { CacheTag, skipBackendAtBuild } from '@/lib/cache-tags'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
import { getSiteInfo } from './misc'

/**
 * 站点信息几乎每个页面都要用（layout、generateMetadata、正文主题都要读），跨请求缓存（'use cache'，cacheLife 'site'），
 * 页面外壳（App Shell）也因此能带上站点名、头像等，所有路由、所有语言共用一条。
 *
 * 管理员在后台保存配置后，后端换掉 site 标签的版本号，各前端实例在几秒内轮询到并让缓存失效（见 lib/cache-tags.ts、
 * web/use-cache-handler.mjs），带这个标签的页面（全部前台页面）下次访问时重新生成。cacheLife 的 revalidate（30 秒）只是轮询失败时的兜底，
 * 过期按 stale-while-revalidate 处理：过期后的第一个请求仍拿到旧值并在后台刷新。
 * 取不到时直接抛错（抛出的错误不缓存），不拿兜底内容渲染
 */
async function loadSiteInfo(): Promise<SiteInfo> {
  'use cache'
  cacheLife('site')
  cacheTag(CacheTag.Site)
  const res = await getSiteInfo()
  return res.data
}

/**
 * 页面渲染用：取不到时直接抛错，不拿兜底内容渲染（失败不写缓存）。
 * 前台页面按地址缓存：拿 fallbackSiteInfo 渲染出来的页面会被缓存下来，访客与 CDN 拿到的是兜底的占位站名等内容。
 * 抛错时 Next 继续提供上一份成功生成的页面、下一次请求再重试；还没有成功生成过时这次请求返回错误页，错误页不进缓存。
 * React cache 让同一次渲染里的多处调用只读一次缓存
 */
export const getCachedSiteInfo = cache(async (): Promise<SiteInfo> => {
  skipBackendAtBuild()
  return loadSiteInfo()
})

/**
 * 结果不进页面缓存的地方（robots.txt、分享图，都按请求生成）：取不到时回退到 fallbackSiteInfo，不让爬虫拿到 500。
 * 不要在会被预渲染的地方用它，否则构建期连不上后端时兜底内容会被固化
 */
export const getCachedSiteInfoOrFallback = cache(async (): Promise<SiteInfo> => {
  return loadSiteInfo().catch(() => fallbackSiteInfo)
})
