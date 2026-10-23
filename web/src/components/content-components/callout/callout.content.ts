import type { CalloutProps } from './schema'
import { InfoIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { textParagraphs } from '../content-helpers'
import { defineContentComponent } from '../define'
import { calloutSchema } from './schema'

export default defineContentComponent({
  name: 'callout',
  version: 1,
  schema: calloutSchema,
  component: dynamic(() => import('./callout')),
  icon: InfoIcon,
  keywords: ['callout', 'note', 'tip', 'warning', 'alert', 'tishi', 'ts', 'tishikuang', '提示', '提示框', '警告', '注意'],
  // 降级为引用：标题加粗，正文按行分段
  fallback: ({ title, content }: CalloutProps) => [[
    'blockquote',
    {},
    ...(title ? [['p', {}, ['strong', {}, title]]] : []),
    ...textParagraphs(content),
  ]],
  example: t => ({ type: 'tip' as const, title: t('title'), content: t('content') }),
})
