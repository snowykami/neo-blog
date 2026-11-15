'use client'

import type { ChartConfig } from '@/components/ui/chart'
import type { AIUsageSeries } from '@/models/ai-usage'
import { useFormatter } from 'next-intl'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { formatCompactNumber } from '@/utils/common/number'

// 后端返回服务器时区的自然日，按本地零点解析，避免被当成 UTC
function parseDay(date: string) {
  return new Date(`${date}T00:00:00`)
}

export function AIUsageChart({
  config,
  data,
  series,
}: {
  config: ChartConfig
  data: Array<Record<string, number | string>>
  series: AIUsageSeries[]
}) {
  const format = useFormatter()
  const tickFormatter = (value: string) => format.dateTime(parseDay(value), { month: 'numeric', day: 'numeric' })
  const labelFormatter = (value: unknown) => typeof value === 'string'
    ? format.dateTime(parseDay(value), { month: 'short', day: 'numeric', weekday: 'short' })
    : ''

  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={tickFormatter} />
        <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tickFormatter={(value: number) => formatCompactNumber(value)} />
        <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<ChartTooltipContent labelFormatter={labelFormatter} />} />
        {series.map(s => <Bar key={s.purpose} dataKey={s.purpose} stackId="usage" fill={`var(--color-${s.purpose})`} maxBarSize={24} />)}
        <ChartLegend content={<ChartLegendContent />} />
      </BarChart>
    </ChartContainer>
  )
}
