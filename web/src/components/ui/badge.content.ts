import { TagsIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { z } from 'zod'
import { defineContentComponent } from '@/components/content-components/define'

export const badgesContentSchema = z.object({
  items: z.array(z.object({
    text: z.string().trim().min(1).max(40).default(''),
    variant: z.enum(['default', 'secondary', 'outline', 'destructive']).default('secondary'),
  })).min(1).max(20).default([{ text: '', variant: 'secondary' }]),
})

export type BadgesContentProps = z.output<typeof badgesContentSchema>

export default defineContentComponent({
  name: 'badges',
  version: 1,
  schema: badgesContentSchema,
  component: dynamic(() => import('./badge.content-view')),
  icon: TagsIcon,
  keywords: ['badge', 'tag', 'label', 'huizhang', 'biaoqian', '徽章', '标签'],
  fallback: ({ items }: BadgesContentProps) => [['p', {}, items.map(item => item.text).join(' · ')]],
  example: () => ({
    items: [
      { text: 'Next.js', variant: 'default' as const },
      { text: 'Go', variant: 'secondary' as const },
      { text: 'Tiptap', variant: 'outline' as const },
    ],
  }),
})
