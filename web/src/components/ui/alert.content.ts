import { CircleAlertIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { z } from 'zod'
import { textParagraphs } from '@/components/content-components/content-helpers'
import { defineContentComponent } from '@/components/content-components/define'

export const alertContentSchema = z.object({
  variant: z.enum(['default', 'destructive']).default('default'),
  title: z.string().trim().min(1).max(120).default(''),
  description: z.string().trim().max(2000).meta({ widget: 'textarea' }).default(''),
})

export type AlertContentProps = z.output<typeof alertContentSchema>

export default defineContentComponent({
  name: 'alert',
  version: 1,
  schema: alertContentSchema,
  component: dynamic(() => import('./alert.content-view')),
  icon: CircleAlertIcon,
  keywords: ['alert', 'notice', 'jinggao', 'tongzhi', '警告', '通知', '提醒'],
  fallback: ({ title, description }: AlertContentProps) => [
    ['blockquote', {}, ['p', {}, ['strong', {}, title]], ...textParagraphs(description)],
  ],
  example: t => ({ title: t('title'), description: t('description') }),
})
