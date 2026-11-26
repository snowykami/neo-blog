'use client'
import { Clock } from 'lucide-react'
import { useFormatter, useLocale, useNow, useTranslations } from 'next-intl'
import { Suspense } from 'react'
import { PostMetaItem } from '@/components/blog-post/post-meta-item'
import { Skeleton } from '@/components/ui/skeleton'
import { useBrowserTimeZone } from '@/hooks/use-browser-time-zone'
import { formatUtcOffset, getDateInTimeZone, getTimeZoneDisplayName, getTimeZoneOffset, isValidTimeZone } from '@/utils/common/time-zone'

function UserLocalTimeClock({
  timeZone,
  viewerTimeZone,
}: {
  timeZone: string
  viewerTimeZone: string
}) {
  const t = useTranslations('UserPage')
  const format = useFormatter()
  const locale = useLocale()
  const now = useNow({ updateInterval: 1000 })

  const offset = getTimeZoneOffset(timeZone, now)
  const zoneName = getTimeZoneDisplayName(timeZone, locale, now)
  const diff = offset - getTimeZoneOffset(viewerTimeZone, now)
  const sameDay = getDateInTimeZone(timeZone, now) === getDateInTimeZone(viewerTimeZone, now)
  // 全局未配置 timeZone 时 next-intl 会用服务器时区，这里必须显式传入用户的时区
  const time = format.dateTime(now, sameDay
    ? { timeZone, timeStyle: 'short' }
    : { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' })

  const hours = Math.floor(Math.abs(diff) / 60)
  const minutes = Math.abs(diff) % 60
  const duration = format.list([
    ...(hours ? [format.number(hours, { style: 'unit', unit: 'hour', unitDisplay: 'long' })] : []),
    ...(minutes ? [format.number(minutes, { style: 'unit', unit: 'minute', unitDisplay: 'long' })] : []),
  ], { type: 'unit', style: 'long' })

  return (
    <PostMetaItem icon={Clock} label={t('local_time')}>
      <span title={timeZone}>
        {time}
        {' · '}
        {zoneName ? t('local_time_zone', { zone: zoneName, offset: formatUtcOffset(offset) }) : formatUtcOffset(offset)}
      </span>
      {diff !== 0 && (
        <span>
          {' · '}
          {t(diff > 0 ? 'local_time_ahead' : 'local_time_behind', { duration })}
        </span>
      )}
    </PostMetaItem>
  )
}

/**
 * 主页上的当地时间：每秒刷新，附带本地化的时区名称、UTC 偏移和与访问者的时差。
 * 注意：next-intl 的 useNow 在服务端渲染时会调用 new Date()，在无段级 loading.tsx 的静态导航路由下会触发
 * 'Render in Browser' bailout 导致 500，因此必须将 useNow 隔离在仅浏览器水合后挂载的 Suspense 子组件中
 */
export function UserLocalTime({ timeZone }: { timeZone: string }) {
  const t = useTranslations('UserPage')
  const viewerTimeZone = useBrowserTimeZone()

  if (!isValidTimeZone(timeZone))
    return null

  const placeholder = (
    <PostMetaItem icon={Clock} label={t('local_time')}>
      <Skeleton aria-hidden className="h-4 w-40" />
    </PostMetaItem>
  )

  // 「现在」只在浏览器里取（服务端不下发 now，页面对所有人一致）：服务端渲染与水合阶段先占位，避免水合不一致与静态渲染 bailout
  if (!viewerTimeZone)
    return placeholder

  return (
    <Suspense fallback={placeholder}>
      <UserLocalTimeClock timeZone={timeZone} viewerTimeZone={viewerTimeZone} />
    </Suspense>
  )
}
