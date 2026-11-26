'use client'

import type { Post } from '@/models/post'
import type { UserTab } from '@/utils/common/route'
import { FileTextIcon, HeartIcon, MessageSquareIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { parseAsInteger, useQueryState } from 'nuqs'
import { Suspense, useLayoutEffect, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useHashState } from '@/hooks/use-hash-state'
import { isAdmin } from '@/utils/common/permission'
import { USER_TABS } from '@/utils/common/route'
import { isCommentEnabled, isLikeEnabled } from '@/utils/common/siteinfo'
import { UserComments } from './user-comments'
import { UserLikes } from './user-likes'
import { UserPosts } from './user-posts'

function UserTabPageResetBridge({
  resetRef,
}: {
  resetRef: React.MutableRefObject<(() => void) | null>
}) {
  const [, setPage] = useQueryState('page', parseAsInteger.withOptions({ history: 'replace', clearOnDefault: true }))
  useLayoutEffect(() => {
    resetRef.current = () => {
      void setPage(null)
    }
    return () => {
      resetRef.current = null
    }
  }, [resetRef, setPage])
  return null
}

/**
 * 用户主页内容切换：文章 / 评论 / 喜欢，当前标签写入 URL hash（#comments）
 * 没带 hash 时是文章；从评论区点作者进来带 #comments，分享出去的链接也能直接落在对应标签
 * 「喜欢」默认仅本人与管理员可见，用户开启「公开我的喜欢」后所有人可见，与后端权限一致
 */
export function UserContentTabs({
  userId,
  baseUrl,
  showLikes,
  initialPosts,
}: {
  userId: number
  baseUrl: string
  showLikes: boolean
  initialPosts?: { posts: Post[], total: number }
}) {
  const t = useTranslations('UserPage')
  const { user: currentUser } = useAuth()
  const { siteInfo } = useSiteInfo()
  const canViewComments = isCommentEnabled(siteInfo)
  const canViewLikes = isLikeEnabled(siteInfo) && (showLikes || (!!currentUser && (currentUser.id === userId || isAdmin({ user: currentUser }))))
  const [tab, setTab] = useHashState<UserTab>(USER_TABS, 'posts')
  const resetPageRef = useRef<(() => void) | null>(null)
  // 无权查看喜欢或评论功能关闭时回退到文章
  const activeTab = (tab === 'likes' && !canViewLikes) || (tab === 'comments' && !canViewComments) ? 'posts' : tab

  return (
    <Tabs
      value={activeTab}
      // 切换标签时清空分页参数，各列表的页码互不影响
      onValueChange={(value) => {
        setTab(value as UserTab)
        resetPageRef.current?.()
      }}
      className="gap-4"
    >
      <Suspense fallback={null}>
        <UserTabPageResetBridge resetRef={resetPageRef} />
      </Suspense>
      <TabsList className="mx-4 md:mx-2">
        <TabsTrigger value="posts" className="px-3">
          <FileTextIcon aria-hidden />
          {t('tab_posts')}
        </TabsTrigger>
        {canViewComments && (
          <TabsTrigger value="comments" className="px-3">
            <MessageSquareIcon aria-hidden />
            {t('tab_comments')}
          </TabsTrigger>
        )}
        {canViewLikes && (
          <TabsTrigger value="likes" className="px-3">
            <HeartIcon aria-hidden />
            {t('tab_likes')}
          </TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="posts">
        <UserPosts userId={userId} baseUrl={baseUrl} initialPosts={initialPosts} />
      </TabsContent>
      {canViewComments && (
        <TabsContent value="comments">
          <UserComments userId={userId} />
        </TabsContent>
      )}
      {canViewLikes && (
        <TabsContent value="likes">
          <UserLikes userId={userId} isPublic={showLikes} />
        </TabsContent>
      )}
    </Tabs>
  )
}
