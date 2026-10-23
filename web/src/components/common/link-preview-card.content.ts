import { LinkIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { z } from 'zod'
import { hrefSchema, linkAttrs } from '@/components/content-components/content-helpers'
import { defineContentComponent } from '@/components/content-components/define'

export const linkCardContentSchema = z.object({
  url: hrefSchema().default(''),
})

export type LinkCardContentProps = z.output<typeof linkCardContentSchema>

export default defineContentComponent({
  name: 'linkCard',
  version: 1,
  schema: linkCardContentSchema,
  component: dynamic(() => import('./link-preview-card.content-view')),
  icon: LinkIcon,
  keywords: ['link', 'card', 'preview', 'url', 'lianjie', 'lj', 'lianjiekapian', '链接', '链接卡片', '网址'],
  fallback: ({ url }: LinkCardContentProps) => [['p', {}, ['a', linkAttrs(url), url]]],
  example: () => ({ url: 'https://github.com/snowykami/neo-blog' }),
})
