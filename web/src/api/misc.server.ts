import type { SiteInfo } from '@/utils/common/siteinfo'
import { unstable_cache } from 'next/cache'
import { cache } from 'react'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
import { getSiteInfo } from './misc'

/**
 * 站点信息几乎每个页面都要用（layout、generateMetadata、正文主题都要读）。
 *
 * 之前只用 React cache：它只在**单次请求内**去重，每个请求仍会打一次后端。
 * 现在用 unstable_cache 做跨请求缓存（30 秒），一次渲染分享一次结果，多个请求之间也复用，
 * 每页少一次后端往返（同机房 10~30ms，跨机房更多）。
 *
 * 管理员在后台改站点配置后，最多 30 秒生效；要立刻看到可调用 revalidateTag('site-info')。
 * 迁移到 Cache Components 后，这里换成 `use cache` + `cacheLife`。
 */
const SITE_INFO_REVALIDATE_SECONDS = 30

const loadSiteInfo = unstable_cache(
  async (): Promise<SiteInfo> => {
    const res = await getSiteInfo()
    return res.data
  },
  ['site-info'],
  { revalidate: SITE_INFO_REVALIDATE_SECONDS, tags: ['site-info'] },
)

/** 获取失败时回退到 fallbackSiteInfo，避免页面因站点信息缺失而 500（失败不写缓存） */
export const getCachedSiteInfo = cache(async (): Promise<SiteInfo> => {
  return loadSiteInfo().catch(() => fallbackSiteInfo)
})
