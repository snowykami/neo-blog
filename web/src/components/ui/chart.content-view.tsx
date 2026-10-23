'use client'

import type { ChartContentProps } from './chart.content'
import type { ChartConfig } from '@/components/ui/chart'
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'

/** 简单图表：柱状图 / 折线图，单个数据系列 */
export default function ChartContent({ title, type, unit, data }: ChartContentProps) {
  const config: ChartConfig = { value: { label: unit || title || 'value', color: 'var(--primary)' } }
  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
      <YAxis tickLine={false} axisLine={false} width={40} />
      <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
    </>
  )
  return (
    <figure className="rounded-xl border bg-card p-4">
      {title && <figcaption className="mb-3 text-sm font-medium">{title}</figcaption>}
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        {type === 'line'
          ? (
              <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
                {axes}
                <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            )
          : (
              <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
                {axes}
                <Bar dataKey="value" fill="var(--color-value)" radius={6} />
              </BarChart>
            )}
      </ChartContainer>
    </figure>
  )
}
