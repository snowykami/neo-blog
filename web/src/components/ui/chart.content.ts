import type { DOMOutputSpec } from '@tiptap/pm/model'
import { ChartColumnIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { z } from 'zod'
import { defineContentComponent } from '@/components/content-components/define'

export const chartContentSchema = z.object({
  title: z.string().trim().max(120).default(''),
  type: z.enum(['bar', 'line']).default('bar'),
  // 数值单位，显示在提示与降级表格中
  unit: z.string().trim().max(20).default(''),
  data: z.array(z.object({
    label: z.string().trim().min(1).max(30).default(''),
    value: z.number().min(-1e12).max(1e12).default(0),
  })).min(1).max(24).default([{ label: '', value: 0 }]),
})

export type ChartContentProps = z.output<typeof chartContentSchema>

export default defineContentComponent({
  name: 'chart',
  version: 1,
  schema: chartContentSchema,
  component: dynamic(() => import('./chart.content-view')),
  icon: ChartColumnIcon,
  keywords: ['chart', 'graph', 'bar', 'line', 'tubiao', 'tb', 'zhuzhuangtu', 'zhexiantu', '图表', '柱状图', '折线图', '统计'],
  // 降级为表格
  fallback: ({ title, unit, data }: ChartContentProps) => [
    ...(title ? [['p', {}, ['strong', {}, title]] as DOMOutputSpec] : []),
    ['table', {}, ['tbody', {}, ...data.map(item => ['tr', {}, ['td', {}, item.label], ['td', {}, `${item.value}${unit}`]])]],
  ],
  example: t => ({
    title: t('title'),
    data: [
      { label: 'Q1', value: 12 },
      { label: 'Q2', value: 18 },
      { label: 'Q3', value: 9 },
      { label: 'Q4', value: 24 },
    ],
  }),
})
