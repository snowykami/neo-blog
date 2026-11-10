'use client'

import type { VisitTargetType } from '@/models/visit'
import { useEffect } from 'react'
import { usePathname } from '@/i18n/navigation'
import { trackPageview } from '@/utils/client/analytics'

// 站内跳转时以上一个页面作为来源，首次进入时使用 document.referrer
let previousPath: string | null = null

/**
 * 访问上报：页面在服务端渲染，后端拿不到访客的 IP 与 Cookie，因此由浏览器在路由变化后上报一次（经 Plausible tracker，见 utils/client/analytics）
 * - 文章/页面详情传入 targetType/targetId，其余页面只上报路径
 * - skipPrefixes 用于跳过由详情页自行上报的路径，避免重复
 */
export function VisitReporter({
  targetType,
  targetId,
  skipPrefixes,
}: {
  targetType?: VisitTargetType
  targetId?: number
  skipPrefixes?: string[]
}) {
  const pathname = usePathname()
  // 转为字符串作为依赖：调用方传入的字面量数组每次渲染都是新对象
  const skipKey = skipPrefixes?.join(',') ?? ''

  useEffect(() => {
    if (skipKey.split(',').some(prefix => prefix && pathname.startsWith(prefix)))
      return
    // pathname 已去掉语言前缀（用于匹配 skipPrefixes）；上报的是地址栏里的真实地址，带语言前缀（/en/p/x）
    const path = `${window.location.pathname}${window.location.search}`
    const referrer = previousPath ? `${window.location.origin}${previousPath}` : document.referrer
    previousPath = path
    trackPageview({ url: `${window.location.origin}${path}`, referrer, targetType, targetId })
      .catch(() => {
        // 上报失败不影响浏览
      })
  }, [pathname, targetType, targetId, skipKey])

  return null
}
