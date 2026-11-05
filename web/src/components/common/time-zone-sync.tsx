'use client'

import { useTimeZone } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { getBrowserTimeZone, isValidTimeZone, TIME_ZONE_COOKIE } from '@/utils/common/time-zone'

const ONE_YEAR_SECONDS = 365 * 24 * 3600

/**
 * 让页面上的时间按浏览器的时区显示：页面用的时区与浏览器不同时（第一次访问、换了时区），
 * 把浏览器时区记进 cookie 并刷新一次服务端数据，之后的服务端渲染直接按它格式化
 */
export function TimeZoneSync() {
  const timeZone = useTimeZone()
  const router = useRouter()
  useEffect(() => {
    const browserTimeZone = getBrowserTimeZone()
    if (!isValidTimeZone(browserTimeZone) || browserTimeZone === timeZone)
      return
    document.cookie = `${TIME_ZONE_COOKIE}=${browserTimeZone}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
    router.refresh()
  }, [timeZone, router])
  return null
}
