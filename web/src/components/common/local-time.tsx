'use client'

import type { DateTimeFormatOptions } from 'next-intl'
import { useFormatter } from 'next-intl'

/**
 * 按访客本机时区显示的时间（服务端组件里要显示时间时用它）：
 * 服务端按固定时区渲染，水合后由 ClientI18nProvider 换成本机时区重新格式化；服务端组件自己格式化出的文本水合后不会再变
 */
export function LocalTime({ value, options, className }: { value: string, options: DateTimeFormatOptions, className?: string }) {
  const format = useFormatter()
  return <time dateTime={value} className={className}>{format.dateTime(new Date(value), options)}</time>
}
