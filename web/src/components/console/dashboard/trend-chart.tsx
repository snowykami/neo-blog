'use client'

import type { ChartConfig } from '@/components/ui/chart'
import type { DashboardTrendPoint } from '@/models/dashboard'
import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

// 流量看访问与访客的走势（面积图），互动看每天的评论与点赞（柱状图）
const VIEWS = ['traffic', 'interaction'] as const
type View = (typeof VIEWS)[number]

// 后端返回服务器时区的自然日，按本地零点解析，避免被当成 UTC
function parseDay(date: string) {
  return new Date(`${date}T00:00:00`)
}

export function TrendChart({ trend, className }: { trend: DashboardTrendPoint[], className?: string }) {
  const t = useTranslations('Console.dashboard')
  const format = useFormatter()
  const [view, setView] = useState<View>('traffic')

  const config: ChartConfig = view === 'traffic'
    ? {
        pv: { label: t('metric_pv'), color: 'var(--chart-1)' },
        uv: { label: t('metric_uv'), color: 'var(--chart-2)' },
      }
    : {
        comments: { label: t('metric_comments'), color: 'var(--chart-1)' },
        likes: { label: t('metric_likes'), color: 'var(--chart-2)' },
      }
  const keys = Object.keys(config)

  const tickFormatter = (value: string) => format.dateTime(parseDay(value), { month: 'numeric', day: 'numeric' })
  const labelFormatter = (value: unknown) => typeof value === 'string'
    ? format.dateTime(parseDay(value), { month: 'short', day: 'numeric', weekday: 'short' })
    : ''
  const axisProps = { tickLine: false, axisLine: false } as const
  const xAxis = <XAxis dataKey="date" {...axisProps} tickMargin={8} minTickGap={24} tickFormatter={tickFormatter} />
  const yAxis = <YAxis {...axisProps} width={32} allowDecimals={false} />
  const tooltip = <ChartTooltip cursor={view === 'interaction' ? { fill: 'var(--muted)', opacity: 0.6 } : true} content={<ChartTooltipContent labelFormatter={labelFormatter} />} />
  const legend = <ChartLegend content={<ChartLegendContent />} />

  return (
    <Card className={cn('gap-4 py-4', className)}>
      <CardHeader className="px-4">
        <CardTitle>{t('trend_title')}</CardTitle>
        <CardDescription>{t(`trend_${view}_description`)}</CardDescription>
        <CardAction>
          <Tabs value={view} onValueChange={value => setView(value as View)}>
            <TabsList>
              {VIEWS.map(item => <TabsTrigger key={item} value={item}>{t(`trend_${item}`)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          {view === 'traffic'
            ? (
                <AreaChart data={trend} margin={{ left: 0, right: 8, top: 8 }}>
                  <defs>
                    {keys.map(key => (
                      <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.4} />
                        <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.05} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid vertical={false} />
                  {xAxis}
                  {yAxis}
                  {tooltip}
                  {keys.map(key => (
                    <Area
                      key={key}
                      dataKey={key}
                      type="monotone"
                      fill={`url(#fill-${key})`}
                      stroke={`var(--color-${key})`}
                      strokeWidth={2}
                    />
                  ))}
                  {legend}
                </AreaChart>
              )
            : (
                <BarChart data={trend} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  {xAxis}
                  {yAxis}
                  {tooltip}
                  {keys.map(key => <Bar key={key} dataKey={key} fill={`var(--color-${key})`} radius={[4, 4, 0, 0]} maxBarSize={24} />)}
                  {legend}
                </BarChart>
              )}
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
