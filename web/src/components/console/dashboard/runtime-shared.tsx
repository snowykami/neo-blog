'use client'

import type { useTranslations } from 'next-intl'
import { JetBrains_Mono } from 'next/font/google'

// 「系统运行」各部分共用的字体、格式与小组件

/** 各实例上报、依赖服务采集的间隔 */
export const REPORT_INTERVAL_SECONDS = 15

export const jetBrainsMono = JetBrains_Mono({
  variable: '--font-jet-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

/** 指标达到阈值时的级别：偏高 / 过高（将满） */
export type Level = 'warning' | 'critical' | null

export const formatRate = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1))

/** 趋势线上某个点距今多久 */
export function pointAgo(t: ReturnType<typeof useTranslations<'Console.dashboard'>>, stepsAgo: number) {
  return stepsAgo === 0 ? t('runtime_point_latest', { seconds: REPORT_INTERVAL_SECONDS }) : t('runtime_point_ago', { seconds: stepsAgo * REPORT_INTERVAL_SECONDS })
}

/** 提示内容：数值在前，说明在后 */
export function Tip({ value, lines }: { value: string, lines: string[] }) {
  return (
    <div className="grid gap-0.5">
      <span className="font-semibold tabular-nums">{value}</span>
      {lines.map(line => <span key={line} className="opacity-80">{line}</span>)}
    </div>
  )
}
