import type { DOMOutputSpec } from '@tiptap/pm/model'
import { SquareIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { z } from 'zod'
import { textParagraphs } from '@/components/content-components/content-helpers'
import { defineContentComponent } from '@/components/content-components/define'

export const cardContentSchema = z.object({
  title: z.string().trim().min(1).max(120).default(''),
  description: z.string().trim().max(300).default(''),
  content: z.string().trim().max(4000).meta({ widget: 'textarea' }).default(''),
})

export type CardContentProps = z.output<typeof cardContentSchema>

export default defineContentComponent({
  name: 'card',
  version: 1,
  schema: cardContentSchema,
  component: dynamic(() => import('./card.content-view')),
  icon: SquareIcon,
  keywords: ['card', 'box', 'kapian', 'kp', '卡片'],
  fallback: ({ title, description, content }: CardContentProps) => [
    ['p', {}, ['strong', {}, title]],
    ...(description ? [['p', {}, description] as DOMOutputSpec] : []),
    ...textParagraphs(content),
  ],
  example: t => ({ title: t('title'), description: t('description'), content: t('content') }),
})
