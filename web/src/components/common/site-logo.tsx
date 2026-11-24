'use client'

import { House } from 'lucide-react'
import { SafeImage } from '@/components/common/safe-image'
import { useSiteInfo } from '@/contexts/site-info-context'
import { cn } from '@/lib/utils'
import { normalizeSiteIconRadius } from '@/utils/common/siteinfo'

/**
 * 站点标识：优先使用站点配置的图标，未配置或加载失败时回退为首页图标
 * 前台导航与后台侧栏共用，圆角比例与浏览器标签栏 Favicon 同步
 */
export function SiteLogo({ className }: { className?: string }) {
  const { siteInfo } = useSiteInfo()
  const fallback = <House aria-hidden className={cn('size-6', className)} />
  const icon = siteInfo?.metadata?.icon
  if (!icon)
    return fallback
  const radius = normalizeSiteIconRadius(siteInfo?.metadata?.iconRadius)
  return (
    <SafeImage
      src={icon}
      alt=""
      width={24}
      height={24}
      style={{ borderRadius: `${radius}%` }}
      className={cn('size-6 object-cover', className)}
      fallback={fallback}
    />
  )
}
