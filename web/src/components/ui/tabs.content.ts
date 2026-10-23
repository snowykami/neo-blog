import { PanelsTopLeftIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { z } from 'zod'
import { textParagraphs } from '@/components/content-components/content-helpers'
import { defineContentComponent } from '@/components/content-components/define'

export const textTabsContentSchema = z.object({
  tabs: z.array(z.object({
    label: z.string().trim().min(1).max(40).default(''),
    content: z.string().trim().min(1).max(4000).meta({ widget: 'textarea' }).default(''),
  })).min(1).max(8).default([{ label: '', content: '' }]),
})

export type TextTabsContentProps = z.output<typeof textTabsContentSchema>

export default defineContentComponent({
  name: 'textTabs',
  version: 1,
  schema: textTabsContentSchema,
  component: dynamic(() => import('./tabs.content-view')),
  icon: PanelsTopLeftIcon,
  keywords: ['tabs', 'tab', 'biaoqianye', 'bqy', 'qiehuan', '标签页', '选项卡', '切换'],
  fallback: ({ tabs }: TextTabsContentProps) => tabs.flatMap(tab => [['p', {}, ['strong', {}, tab.label]], ...textParagraphs(tab.content)]),
  example: t => ({
    tabs: [
      { label: t('tab1'), content: t('content1') },
      { label: t('tab2'), content: t('content2') },
    ],
  }),
})
