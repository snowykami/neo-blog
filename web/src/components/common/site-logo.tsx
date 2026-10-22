'use client'

import { House } from 'lucide-react'
import { SafeImage } from '@/components/common/safe-image'
import { useSiteInfo } from '@/contexts/site-info-context'
import { cn } from '@/lib/utils'

/**
 * 站点标识：优先使用站点配置的图标，未配置或加载失败时回退为首页图标
 * 前台导航与后台侧栏共用，保证两处品牌标识一致
 */
export function SiteLogo({ className }: { className?: string }) {
  const { siteInfo } = useSiteInfo()
  const fallback = <House aria-hidden className={cn('size-6', className)} />
  const icon = siteInfo?.metadata?.icon
  if (!icon)
    return fallback
  return (
    <SafeImage
      src={icon}
      alt=""
      width={24}
      height={24}
      // 站点图标常为 svg / ico，且尺寸很小，直接使用原图不经过图片优化
      unoptimized
      className={cn('size-6 rounded-md object-cover', className)}
      fallback={fallback}
    />
  )
}
