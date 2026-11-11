'use client'
import type { Post } from '@/models/post'
import type { BaseResponseError } from '@/models/resp'
import { DropdownMenuGroup } from '@radix-ui/react-dropdown-menu'
import { Ellipsis, Eye } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { listPinnedPostsAdmin, listPostsAdmin } from '@/api/admin'
import { deletePost, listMyPosts, updatePost } from '@/api/post'
import { HoverPopover } from '@/components/common/hover-popover'
import { OrderSelector } from '@/components/common/orderby-selector'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { Popconfirm } from '@/components/common/popconfirm'
import { SafeImage } from '@/components/common/safe-image'
import { CreateOrUpdatePostMetaDialogWithoutButton } from '@/components/console/common/post-meta-dialog-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/contexts/auth-context'
import { useDevice } from '@/contexts/device-context'
import { useConsoleQuery } from '@/hooks/use-console-query'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useIsMobile } from '@/hooks/use-mobile'
import { useToPost } from '@/hooks/use-route'
import { useCommonT, useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { OrderBy } from '@/models/common'
import { PINNED_POSTS_LIMIT } from '@/models/post'
import { isAdmin } from '@/utils/common/permission'
import { getPostEditUrl } from '@/utils/common/route'
import { AISummaryBadges, PostDescriptionLine, useAISummary, useAISummaryMenuLabel } from './post-ai-summary'
import { PostAISummaryBatchButton } from './post-ai-summary-batch'
import { usePinUntilText, usePostPinAction } from './post-pin'

const PAGE_SIZE = 15
const MOBILE_PAGE_SIZE = 10

export function PostManage() {
  const t = useTranslations('Console.post_edit')
  const commonT = useCommonT()
  const metricsT = useTranslations('Metrics')
  const { isMobile } = useDevice()
  const { user } = useAuth()
  // 管理员可管理所有文章，编辑者只能管理自己的文章
  const isAdminUser = !!user && isAdmin({ user })
  const [orderBy, setOrderBy] = useQueryState(
    'order_by',
    parseAsStringEnum<OrderBy>(Object.values(OrderBy))
      .withDefault(OrderBy.CreatedAt)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [desc, setDesc] = useQueryState(
    'desc',
    parseAsBoolean.withDefault(true).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [page, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [size, setSize] = useQueryState(
    'size',
    parseAsInteger
      .withDefault(isMobile ? MOBILE_PAGE_SIZE : PAGE_SIZE)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  // 搜索词用本地状态管理，不通过 URL
  const [queryInput, setQueryInput, debouncedQueryInput] = useDebouncedState(
    '',
    200,
  )
  const [onlyMine, setOnlyMine] = useQueryState(
    'only_mine',
    parseAsBoolean.withDefault(false).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  // 只看首页上的置顶文章（管理员），不分页
  const [onlyPinned, setOnlyPinned] = useQueryState(
    'only_pinned',
    parseAsBoolean.withDefault(false).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [createPostDialogOpen, setCreatePostDialogOpen] = useState(false)
  // 列表取数：回到这个页面时先显示上次的结果，同时重新请求（见 hooks/use-console-query.ts）；写操作后缓存会被清空
  const listPosts = useConsoleQuery(
    ['admin/posts', isAdminUser, page, size, orderBy, desc, debouncedQueryInput, onlyMine, onlyPinned],
    async () => {
      if (!user)
        return { posts: [], total: 0 }
      if (isAdminUser && onlyPinned) {
        const res = await listPinnedPostsAdmin()
        return { posts: res.data.posts, total: res.data.posts.length }
      }
      const params = { page, size, orderBy, desc, query: debouncedQueryInput }
      const res = isAdminUser
        ? await listPostsAdmin({ ...params, userId: onlyMine ? user.id : 0 })
        : await listMyPosts(params)
      return { posts: res.data.posts, total: res.data.total }
    },
  )
  const posts = listPosts.data?.posts ?? []
  const total = listPosts.data?.total ?? 0
  const { refresh: refreshPosts, setData: setPostList } = listPosts

  // 防抖后的搜索词真正变化时才重置分页，避免挂载时把 URL 中的页码重置为 1
  const prevQueryRef = useRef(debouncedQueryInput)
  useEffect(() => {
    if (prevQueryRef.current === debouncedQueryInput)
      return
    prevQueryRef.current = debouncedQueryInput
    setPage(1)
  }, [debouncedQueryInput, setPage])

  const onPostCreate = useCallback(() => {
    // 创建新文章后重新拉取列表，新文章需要后端分配的 ID 与排序位置
    void refreshPosts()
  }, [refreshPosts])

  const onPostUpdate = useCallback(
    ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => {
      setPostList(prev => prev && { ...prev, posts: prev.posts.map(p => (p.id === post.id ? { ...p, ...post } : p)) })
    },
    [setPostList],
  )

  const onPostDelete = useCallback(
    ({ postId }: { postId: number }) => {
      setPostList(prev => prev && { posts: prev.posts.filter(p => p.id !== postId), total: Math.max(0, prev.total - 1) })
    },
    [setPostList],
  )

  const onOrderChange = useCallback(
    ({ orderBy, desc }: { orderBy: OrderBy, desc: boolean }) => {
      setOrderBy(orderBy)
      setDesc(desc)
      setPage(1)
    },
    [setOrderBy, setDesc, setPage],
  )

  const onPageChange = useCallback(
    (p: number) => {
      setPage(p)
    },
    [setPage],
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-x-3 gap-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="search"
            placeholder={commonT('search')}
            value={queryInput}
            onChange={e => setQueryInput(e.target.value)}
          />
          {isAdminUser && (
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                id="post-manage-only-mine"
                checked={onlyMine}
                onCheckedChange={(checked) => {
                  setOnlyMine(checked)
                  setPage(1)
                }}
              />
              <Label htmlFor="post-manage-only-mine">{t('only_mine')}</Label>
            </div>
          )}
          {isAdminUser && (
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                id="post-manage-only-pinned"
                checked={onlyPinned}
                onCheckedChange={(checked) => {
                  setOnlyPinned(checked)
                  setPage(1)
                }}
              />
              <Label htmlFor="post-manage-only-pinned">{t('only_pinned', { max: PINNED_POSTS_LIMIT })}</Label>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <OrderSelector
              value={{ orderBy, desc }}
              onOrderChange={onOrderChange}
              orderBys={[
                OrderBy.CreatedAt,
                OrderBy.UpdatedAt,
                OrderBy.Heat,
                OrderBy.CommentCount,
                OrderBy.LikeCount,
                OrderBy.ViewCount,
              ]}
            />
            {isAdminUser && <PostAISummaryBatchButton onQueued={() => void refreshPosts()} />}
            <Button size="sm" onClick={() => setCreatePostDialogOpen(true)}>
              {t('create_post')}
            </Button>
            <CreateOrUpdatePostMetaDialogWithoutButton
              open={createPostDialogOpen}
              onOpenChange={setCreatePostDialogOpen}
              post={null}
              onPostChange={onPostCreate}
            />
          </div>
        </div>
      </div>
      <Separator className="flex-1" />
      {posts.map(post => (
        <div key={post.id}>
          <PostItem
            post={post}
            showAuthor={isAdminUser}
            canConfigureAI={isAdminUser}
            canPin={isAdminUser}
            onPostUpdate={onPostUpdate}
            onPostDelete={onPostDelete}
          />
          <Separator className="flex-1" />
        </div>
      ))}
      {/* 只看置顶时最多 3 篇，不分页 */}
      <div className="flex justify-center items-center py-4" hidden={isAdminUser && onlyPinned}>
        {total > 0 && (
          <PaginationController
            page={page}
            onPageChange={onPageChange}
            total={total}
            pageSize={size}
          />
        )}
        <PageSizeSelector
          size={size}
          onSizeChange={(s) => {
            setSize(s)
            setPage(1)
          }}
        />
        {' '}
        {metricsT('per_page')}
      </div>
    </div>
  )
}

function PostItem({
  post,
  showAuthor,
  canConfigureAI,
  canPin,
  onPostUpdate,
  onPostDelete,
}: {
  post: Post
  showAuthor: boolean
  canConfigureAI: boolean // 只有管理员可以在全局配置中配置 AI
  canPin: boolean // 只有管理员可以置顶到首页
  onPostUpdate: ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => void
  onPostDelete: ({ postId }: { postId: number }) => void
}) {
  const commonT = useTranslations('Common')
  const isMobile = useIsMobile()
  const labelCount = isMobile ? 1 : 3
  const postT = useTranslations('Console.post_edit')
  const stateT = useTranslations('State')
  const operationT = useOperationT()
  const clickToPost = useToPost()
  const [metaDialogOpen, setMetaDialogOpen] = useState(false)
  const aiSummary = useAISummary({ post, onPostUpdate, canConfigure: canConfigureAI })
  const pinUntilText = usePinUntilText()
  return (
    <div>
      <div className="flex w-full items-center gap-3 py-3">
        {/* left：占满剩余宽度且可收缩，长描述不会把右侧操作挤出 */}
        <div className="flex min-w-0 flex-1 justify-start items-center gap-4">
          {/* avatar */}
          <div className="flex-shrink-0 w-16 h-9 rounded-md overflow-hidden">
            {/* 没有封面或封面失效时显示占位 */}
            <SafeImage
              src={post.cover}
              alt={post.title}
              width={64} // 和 w-16 (4rem=64px) 保持一致
              height={36} // 和 h-9 (2.25rem=36px) 保持一致
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{post.title}</div>
            <PostDescriptionLine post={post} />
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {(() => {
                const labels = post.labels || []
                // 标签超过可展示数量时折叠为 +n，悬停/点击查看全部
                const labelsTruncated = labels.length > labelCount
                const labelsValue
                  = labels.length === 0
                    ? postT('no_label')
                    : !labelsTruncated
                        ? `${postT('labels')}: ${labels.map(l => l.name).join(' | ')}`
                        : `${postT('labels')}: ${labels
                          .slice(0, labelCount)
                          .map(l => l.name)
                          .join(' | ')} ... (+${labels.length - labelCount})`

                const items: { value: string, className: string, popover?: React.ReactNode }[] = [
                  {
                    value: `${commonT('id')}: ${post.id}`,
                    className: 'bg-indigo-100 text-indigo-800',
                  },
                  ...(showAuthor && post.user
                    ? [{
                        value: `${postT('author')}: ${post.user.nickname || post.user.username}`,
                        className: 'bg-teal-100 text-teal-800',
                      }]
                    : []),
                  ...(post.pinned
                    ? [{
                        value: post.pinnedUntil
                          ? `${commonT('pinned')} · ${postT('pin_until', { date: pinUntilText(post.pinnedUntil) })}`
                          : commonT('pinned'),
                        className: 'bg-amber-100 text-amber-800',
                      }]
                    : []),
                  {
                    value: stateT(post.isPrivate ? 'private' : 'public'),
                    className: post.isPrivate
                      ? 'bg-orange-100 text-orange-800'
                      : 'bg-green-100 text-green-800',
                  },
                  {
                    value: post.category
                      ? `${postT('category')}: ${post.category?.name}`
                      : postT('uncategorized'),
                    className: post.category
                      ? 'bg-pink-100 text-pink-800'
                      : 'bg-gray-100 text-gray-800',
                  },
                  {
                    value: labelsValue,
                    className:
                      post.labels && post.labels.length > 0
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-800',
                    popover: labelsTruncated
                      ? (
                          <div className="grid gap-2">
                            <div className="text-xs text-muted-foreground">{`${postT('labels')} (${labels.length})`}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {labels.map(label => (
                                <Badge key={label.id} className="text-xs bg-blue-100 text-blue-800" variant="secondary">
                                  {label.name}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )
                      : undefined,
                  },
                ]
                return items.map((item, idx) => {
                  const badge = (
                    <Badge key={idx} className={`text-xs ${item.className}`} variant="secondary">
                      {item.value}
                    </Badge>
                  )
                  return item.popover
                    ? (
                        <HoverPopover key={idx} content={item.popover} contentClassName="w-auto max-w-72 p-3">
                          {badge}
                        </HoverPopover>
                      )
                    : badge
                })
              })()}
              <AISummaryBadges post={post} onRetry={aiSummary.trigger} />
            </div>
          </div>
        </div>
        {/* right */}
        <div className="flex items-center ml-auto">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => clickToPost({ post })}
            aria-label={operationT(post.isPrivate ? 'preview' : 'view')}
            title={operationT(post.isPrivate ? 'preview' : 'view')}
          >
            <Eye className="size-4" />
          </Button>
          <PostDropdownMenu
            post={post}
            canPin={canPin}
            onPostUpdate={onPostUpdate}
            onPostDelete={onPostDelete}
            setMetaDialogOpen={setMetaDialogOpen}
            aiSummaryRunning={aiSummary.running}
            onTriggerAISummary={aiSummary.trigger}
          />
          <CreateOrUpdatePostMetaDialogWithoutButton
            post={post}
            onPostChange={onPostUpdate}
            open={metaDialogOpen}
            onOpenChange={setMetaDialogOpen}
          />
        </div>
      </div>
    </div>
  )
}

function PostDropdownMenu({
  post,
  canPin,
  onPostUpdate,
  onPostDelete,
  setMetaDialogOpen,
  aiSummaryRunning,
  onTriggerAISummary,
}: {
  post: Post
  canPin: boolean
  onPostUpdate: ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => void
  onPostDelete: ({ postId }: { postId: number }) => void
  setMetaDialogOpen: (open: boolean) => void
  aiSummaryRunning: boolean
  onTriggerAISummary: () => void
}) {
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const clickToPost = useToPost()
  const aiSummaryLabel = useAISummaryMenuLabel(post)
  const postT = useTranslations('Console.post_edit')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const togglePin = usePostPinAction(post, state => onPostUpdate({ post: { id: post.id, ...state } }))
  const handleTogglePrivate = () => {
    // 只提交需要修改的字段：列表里的正文是截断后的摘要，整篇提交会覆盖原文
    updatePost({ post: { id: post.id, isPrivate: !post.isPrivate } })
      .then(() => {
        toast.success(operationT('update_success'))
        onPostUpdate({ post: { id: post.id, isPrivate: !post.isPrivate } })
      })
      .catch((error: BaseResponseError) => {
        toast.error(
          `${operationT('update_failed')}: ${errorMessageT(error)}`,
        )
      })
  }

  // 失败时抛出，由 Popconfirm 统一提示并保持打开
  const handleDelete = async () => {
    await deletePost({ id: post.id })
    toast.success(operationT('delete_success'))
    onPostDelete({ postId: post.id })
  }

  return (
    <DropdownMenu>
      {/* 菜单项关闭菜单后，删除确认气泡以菜单按钮为锚点就地弹出 */}
      <Popconfirm
        anchorOnly
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={post.title ? operationT('delete_confirm_title', { name: post.title }) : operationT('confirm_delete')}
        description={operationT('delete_description')}
        confirmText={operationT('delete')}
        errorText={operationT('delete_failed')}
        destructive
        onConfirm={handleDelete}
      >
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={operationT('more')} title={operationT('more')}>
            <Ellipsis className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </Popconfirm>
      <DropdownMenuContent
        className="min-w-36"
        align="end"
        // 打开删除确认时不把焦点还给菜单按钮，焦点交给气泡
        onCloseAutoFocus={e => confirmOpen && e.preventDefault()}
      >
        <DropdownMenuGroup>
          {/* 用链接而不是 router.push：菜单打开时（链接挂载）就完整预取编辑器的页面与 JS，点「编辑」时不用再等 */}
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link href={getPostEditUrl({ id: post.id })} prefetch>
              {operationT('edit')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMetaDialogOpen(true)} className="cursor-pointer">
            {operationT('setting')}
          </DropdownMenuItem>
          {/* 私密文章只在后台可见：「查看」打开后台预览 */}
          <DropdownMenuItem onClick={() => clickToPost({ post })} className="cursor-pointer">
            {operationT(post.isPrivate ? 'preview' : 'view')}
          </DropdownMenuItem>
          {/* 生成中禁用，避免重复触发 */}
          <DropdownMenuItem disabled={aiSummaryRunning} onClick={onTriggerAISummary} className="cursor-pointer">
            {aiSummaryLabel}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={handleTogglePrivate} className="cursor-pointer">
            {operationT(post.isPrivate ? 'set_public' : 'set_private')}
          </DropdownMenuItem>
          {canPin && (
            <DropdownMenuItem onClick={togglePin} className="cursor-pointer">
              {postT(post.pinned ? 'unpin_action' : 'pin_to_home')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => setConfirmOpen(true)}
            className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10 cursor-pointer"
          >
            {operationT('delete')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
