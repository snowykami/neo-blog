import { ChartNoAxesGanttIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { z } from 'zod'
import { defineContentComponent } from '@/components/content-components/define'

export const progressContentSchema = z.object({
  items: z.array(z.object({
    label: z.string().trim().min(1).max(60).default(''),
    value: z.number().int().min(0).max(100).default(0),
  })).min(1).max(10).default([{ label: '', value: 0 }]),
})

export type ProgressContentProps = z.output<typeof progressContentSchema>

export default defineContentComponent({
  name: 'progress',
  version: 1,
  schema: progressContentSchema,
  component: dynamic(() => import('./progress.content-view')),
  icon: ChartNoAxesGanttIcon,
  keywords: ['progress', 'bar', 'jindu', 'jd', 'jindutiao', '进度', '进度条'],
  fallback: ({ items }: ProgressContentProps) => [['ul', {}, ...items.map(item => ['li', {}, `${item.label}: ${item.value}%`])]],
  example: t => ({
    items: [
      { label: t('design'), value: 100 },
      { label: t('develop'), value: 60 },
      { label: t('test'), value: 20 },
    ],
  }),
})
