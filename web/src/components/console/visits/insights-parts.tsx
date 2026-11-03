'use client'

import type { NamedCount } from '@/models/visit'
import { useFormatter, useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// 访客统计各卡片共用的展示组件
// 图表系列色：推断位置 / 单系列（蓝）与 IP 归属地（橙），浅色 / 深色分别取值
export const INFERRED_FILL = 'bg-[#2a78d6] dark:bg-[#3987e5]'
export const IP_FILL = 'bg-[#eb6834] dark:bg-[#d95926]'

export function count(list: NamedCount[], name: string) {
  return list.find(item => item.name === name)?.count ?? 0
}

export function StatCard({ label, value, hint }: { label: string, value: string, hint: string }) {
  return (
    <Card className="gap-1 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </Card>
  )
}

export function BarList({ items, total, wide }: { items: NamedCount[], total: number, wide?: boolean }) {
  const t = useTranslations('Console.visit_insights')
  const format = useFormatter()
  if (items.length === 0)
    return <p className="py-2 text-sm text-muted-foreground">{t('empty')}</p>
  const max = Math.max(1, ...items.map(item => item.count))
  const percent = (value: number) => format.number(total ? value / total : 0, { style: 'percent', maximumFractionDigits: 1 })
  return (
    <ul className="grid gap-1.5">
      {items.map(item => (
        <li key={item.name} className={cn('grid items-center gap-3 text-sm', wide ? 'grid-cols-[10rem_minmax(0,1fr)_3.5rem]' : 'grid-cols-[6rem_minmax(0,1fr)_3.5rem]')} title={t('count_tip', { name: item.name, count: item.count, percent: percent(item.count) })}>
          <span className="truncate">{item.name}</span>
          <span className="h-2.5">
            <span className={cn('block h-full min-w-0.5 rounded-r', INFERRED_FILL)} style={{ width: `${item.count / max * 100}%` }} />
          </span>
          <span className="text-right text-xs text-muted-foreground tabular-nums">{percent(item.count)}</span>
        </li>
      ))}
    </ul>
  )
}

export function BarListCard({ title, description, items, total, wide, extra }: {
  title: string
  description?: string
  items: NamedCount[]
  total: number
  wide?: boolean
  extra?: { title: string, items: NamedCount[] } // 同一卡片中的第二组排行
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-3 px-4">
        <BarList items={items} total={total} wide={wide} />
        {extra && (
          <>
            <div className="border-t pt-3 text-sm font-medium">{extra.title}</div>
            <BarList items={extra.items} total={total} wide={wide} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
