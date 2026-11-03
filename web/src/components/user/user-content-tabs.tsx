'use client'

import { FileTextIcon, HeartIcon, MessageSquareIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { parseAsInteger, parseAsStringEnum, useQueryStates } from 'nuqs'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/contexts/auth-context'
import { isAdmin } from '@/utils/common/permission'
import { UserComments } from './user-comments'
import { UserLikes } from './user-likes'
import { UserPosts } from './user-posts'

const TABS = ['posts', 'comments', 'likes'] as const
type Tab = typeof TABS[number]

/**
 * 用户主页内容切换：文章 / 评论 / 喜欢，当前标签写入 URL（?tab=comments）
 * 「喜欢」默认仅本人与管理员可见，用户开启「公开我的喜欢」后所有人可见，与后端权限一致
 */
export function UserContentTabs({ userId, showLikes }: { userId: number, showLikes: boolean }) {
  const t = useTranslations('UserPage')
  const { user: currentUser } = useAuth()
  const canViewLikes = showLikes || (!!currentUser && (currentUser.id === userId || isAdmin({ user: currentUser })))
  const [{ tab }, setQuery] = useQueryStates(
    {
      tab: parseAsStringEnum<Tab>([...TABS]).withDefault('posts'),
      page: parseAsInteger,
    },
    { history: 'replace', clearOnDefault: true },
  )
  // 无权查看喜欢时（如分享出去的 ?tab=likes 链接）回退到文章
  const activeTab = tab === 'likes' && !canViewLikes ? 'posts' : tab

  return (
    <Tabs
      value={activeTab}
      // 切换标签时清空分页参数，各列表的页码互不影响
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
        {canViewLikes && (
          <TabsTrigger value="likes" className="px-3">
            <HeartIcon aria-hidden />
            {t('tab_likes')}
          </TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="posts">
        <UserPosts userId={userId} />
      </TabsContent>
      <TabsContent value="comments">
        <UserComments userId={userId} />
      </TabsContent>
      {canViewLikes && (
        <TabsContent value="likes">
          <UserLikes userId={userId} isPublic={showLikes} />
        </TabsContent>
      )}
    </Tabs>
  )
}
