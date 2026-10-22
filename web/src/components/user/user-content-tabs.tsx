'use client'

import { FileTextIcon, MessageSquareIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { parseAsInteger, parseAsStringEnum, useQueryStates } from 'nuqs'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserComments } from './user-comments'
import { UserPosts } from './user-posts'

const TABS = ['posts', 'comments'] as const
type Tab = typeof TABS[number]

/**
 * 用户主页内容切换：文章 / 评论，当前标签写入 URL（?tab=comments）
 */
export function UserContentTabs({ userId }: { userId: number }) {
  const t = useTranslations('UserPage')
  const [{ tab }, setQuery] = useQueryStates(
    {
      tab: parseAsStringEnum<Tab>([...TABS]).withDefault('posts'),
      page: parseAsInteger,
    },
    { history: 'replace', clearOnDefault: true },
  )

  return (
    <Tabs
      value={tab}
      // 切换标签时清空分页参数，两个列表的页码互不影响
      onValueChange={value => setQuery({ tab: value as Tab, page: null })}
      className="gap-4"
    >
      <TabsList className="mx-4 md:mx-2">
        <TabsTrigger value="posts" className="px-3">
          <FileTextIcon aria-hidden />
          {t('tab_posts')}
        </TabsTrigger>
        <TabsTrigger value="comments" className="px-3">
          <MessageSquareIcon aria-hidden />
          {t('tab_comments')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="posts">
        <UserPosts userId={userId} />
      </TabsContent>
      <TabsContent value="comments">
        <UserComments userId={userId} />
      </TabsContent>
    </Tabs>
  )
}
