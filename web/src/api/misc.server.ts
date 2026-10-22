import type { SiteInfo } from '@/utils/common/siteinfo'
import { cache } from 'react'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
import { getSiteInfo } from './misc'

/**
 * 服务端获取站点信息：用 React cache 包装，同一次请求内 layout / generateMetadata / page 共享一次结果
 * 获取失败时回退到 fallbackSiteInfo，避免页面因站点信息缺失而 500
 */
export const getCachedSiteInfo = cache(async (): Promise<SiteInfo> => {
  return getSiteInfo()
    .then(res => res.data)
    .catch(() => fallbackSiteInfo)
})
