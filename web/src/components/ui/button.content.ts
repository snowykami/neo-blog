import { SquareArrowOutUpRightIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { z } from 'zod'
import { hrefSchema, linkAttrs } from '@/components/content-components/content-helpers'
import { defineContentComponent } from '@/components/content-components/define'

export const linkButtonContentSchema = z.object({
  text: z.string().trim().min(1).max(40).default(''),
  // http(s) 地址或站内路径
  href: hrefSchema({ allowRelative: true }).default(''),
  variant: z.enum(['default', 'secondary', 'outline']).default('default'),
  align: z.enum(['left', 'center']).default('left'),
  newTab: z.boolean().default(true),
})

export type LinkButtonContentProps = z.output<typeof linkButtonContentSchema>

export default defineContentComponent({
  name: 'linkButton',
  version: 1,
  schema: linkButtonContentSchema,
  component: dynamic(() => import('./button.content-view')),
  icon: SquareArrowOutUpRightIcon,
  keywords: ['button', 'link', 'anniu', 'an', 'lianjie', '按钮', '链接', '跳转'],
  fallback: ({ text, href, newTab }: LinkButtonContentProps) => [['p', {}, ['a', linkAttrs(href, newTab), text]]],
  example: t => ({ text: t('text'), href: 'https://github.com/snowykami/neo-blog', align: 'center' as const }),
})
