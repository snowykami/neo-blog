'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

const MINUTE = 60
const HOUR = 60 * MINUTE

/**
 * 编辑器“最后保存”时间：1 分钟内显示 xx 秒前，1 小时内显示 xx 分钟前，超过 1 小时显示具体时间
 * 每秒刷新一次，保证相对时间实时变化
 */
export function LastSavedAt({ time, className }: { time: Date, className?: string }) {
  const t = useTranslations('Console.post_edit')
  const format = useFormatter()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // 刚保存时 now 可能还停留在上一次刷新，至少显示 1 秒
  const seconds = Math.max(1, Math.floor((now - time.getTime()) / 1000))
  const isToday = new Date(now).toDateString() === time.toDateString()

  let text: string
  if (seconds < MINUTE)
    text = t('last_saved_seconds_ago', { count: seconds })
  else if (seconds < HOUR)
    text = t('last_saved_minutes_ago', { count: Math.floor(seconds / MINUTE) })
  else
    text = t('last_saved_at', { time: format.dateTime(time, isToday ? { timeStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'medium' }) })

  return (
    <span className={className} title={format.dateTime(time, { dateStyle: 'medium', timeStyle: 'medium' })}>
      {text}
    </span>
  )
}
