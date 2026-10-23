import { ChevronsUpDownIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { z } from 'zod'
import { textParagraphs } from '@/components/content-components/content-helpers'
import { defineContentComponent } from '@/components/content-components/define'

export const collapsibleContentSchema = z.object({
  title: z.string().trim().min(1).max(120).default(''),
  content: z.string().trim().min(1).max(8000).meta({ widget: 'textarea' }).default(''),
  defaultOpen: z.boolean().default(false),
})

export type CollapsibleContentProps = z.output<typeof collapsibleContentSchema>

export default defineContentComponent({
  name: 'collapsible',
  version: 1,
  schema: collapsibleContentSchema,
  component: dynamic(() => import('./collapsible.content-view')),
  icon: ChevronsUpDownIcon,
  keywords: ['collapse', 'details', 'fold', 'spoiler', 'zhedie', 'zd', '折叠', '展开', '剧透'],
  // 无 JS 时用原生 details 折叠
  fallback: ({ title, content, defaultOpen }: CollapsibleContentProps) => [
    ['details', defaultOpen ? { open: '' } : {}, ['summary', {}, title], ...textParagraphs(content)],
  ],
  example: t => ({ title: t('title'), content: t('content') }),
})
