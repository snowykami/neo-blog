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
 * 代价是站点配置有延迟：管理员在后台保存后，前台要等缓存过期才看到新值。这里没有主动失效——
 * 保存请求经 app/api/v1 直接转发到后端，前端不知道配置改了；而且缓存在每个副本各自的 Next 缓存里，
 * 即使在某个副本上调 revalidateTag 也只清得掉那一份。过期按 stale-while-revalidate 处理：
 * 过期后的第一个请求仍拿到旧值并在后台刷新，所以实际延迟是「30 秒 + 到下一次请求为止」，各副本不同步。
 * 需要立即生效时，要么接受这个延迟，要么为 Next 配置共享的缓存处理器（cacheHandler）后再在保存时失效。
 * 迁移到 Cache Components 后，这里换成 `use cache` + `cacheLife`。
 */
const SITE_INFO_REVALIDATE_SECONDS = 30

const loadSiteInfo = unstable_cache(
  async (): Promise<SiteInfo> => {
    const res = await getSiteInfo()
    return res.data
  },
  ['site-info'],
  { revalidate: SITE_INFO_REVALIDATE_SECONDS },
)

/** 获取失败时回退到 fallbackSiteInfo，避免页面因站点信息缺失而 500（失败不写缓存） */
export const getCachedSiteInfo = cache(async (): Promise<SiteInfo> => {
  return loadSiteInfo().catch(() => fallbackSiteInfo)
})
