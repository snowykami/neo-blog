import type { PostRefProps } from './schema'
import { FileTextIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { defineContentComponent } from '../define'
import { postRefSchema } from './schema'

// 文章引用：正文中引用站内另一篇文章，标题、摘要与封面按 id 实时读取
export default defineContentComponent({
  name: 'postRef',
  version: 1,
  // 卡片有封面与摘要，默认较宽
  defaultWidth: 75,
  schema: postRefSchema,
  component: dynamic(() => import('./post-ref')),
  icon: FileTextIcon,
  keywords: ['post', 'article', 'reference', 'ref', 'related', 'link', 'wenzhang', 'yinyong', 'guanlian', '文章', '引用', '关联', '站内', '相关'],
  // 降级为站内链接：无 JS 环境与 RSS 只显示链接，标题等由接口实时读取，不写入正文以避免快照过期
  fallback: ({ postId }: PostRefProps) => [
    ['p', {}, ['a', { href: `/p/${postId}`, target: '_blank', rel: 'noopener noreferrer' }, `/p/${postId}`]],
  ],
  editor: {
    // 「选择文章」：按标题搜索站内文章，点击一条填入文章 id
    action: dynamic(() => import('./post-ref-action')),
  },
})
