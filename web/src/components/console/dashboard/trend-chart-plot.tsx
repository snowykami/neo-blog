'use client'

import type { ChartConfig } from '@/components/ui/chart'
import type { DashboardTrendPoint } from '@/models/dashboard'
import { useFormatter } from 'next-intl'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'

export type TrendChartView = 'traffic' | 'interaction'

// 后端返回服务器时区的自然日，按本地零点解析，避免被当成 UTC
function parseDay(date: string) {
  return new Date(`${date}T00:00:00`)
}

export function TrendChartPlot({
  view,
  trend,
  config,
}: {
  view: TrendChartView
  trend: DashboardTrendPoint[]
  config: ChartConfig
}) {
  const format = useFormatter()
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
  )
}
