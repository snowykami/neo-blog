import type { CodeTabsProps } from './schema'
import { FileCode2Icon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { defineContentComponent } from '../define'
import { codeTabsSchema } from './schema'

export default defineContentComponent({
  name: 'codeTabs',
  version: 1,
  schema: codeTabsSchema,
  component: dynamic(() => import('./code-tabs')),
  icon: FileCode2Icon,
  keywords: ['code', 'tabs', 'group', 'daimazu', 'dmz', 'biaoqian', '代码组', '代码', '标签页', '多语言'],
  // 降级为依次排列的“标签名 + 代码块”
  fallback: ({ tabs }: CodeTabsProps) => tabs.flatMap(tab => [
    ['p', {}, ['strong', {}, tab.label]],
    ['pre', {}, ['code', tab.language ? { class: `language-${tab.language}` } : {}, tab.code]],
  ]),
  ai: { usage: '代码组：同一功能的多种写法并排切换，如不同语言、不同包管理器或不同操作系统的命令；language 为 highlight.js 语言名' },
  example: () => ({
    tabs: [
      { label: 'pnpm', language: 'bash', code: 'pnpm add zod' },
      { label: 'npm', language: 'bash', code: 'npm install zod' },
    ],
  }),
})
