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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { listPinnedPostsAdmin, listPostsAdmin } from '@/api/admin'
import { batchDeletePosts, batchUpdatePostVisibility, deletePost, listMyPosts, updatePost } from '@/api/post'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { HoverPopover } from '@/components/common/hover-popover'
import { OrderSelector } from '@/components/common/orderby-selector'
import { PageSizeSelector } from '@/components/common/page-size-selector'
import { PaginationController } from '@/components/common/pagination'
import { SafeImage } from '@/components/common/safe-image'
import { CreateOrUpdatePostMetaDialogWithoutButton } from '@/components/console/common/post-meta-dialog-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/contexts/auth-context'
import { useDevice } from '@/contexts/device-context'
import { useConsoleQuery } from '@/hooks/use-console-query'
import { useDebouncedState } from '@/hooks/use-debounce'
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
const EMPTY_POSTS: Post[] = []

const PostItem = memo(({
  post,
  selected,
  isMobile,
  onToggleSelect,
  showAuthor,
  canConfigureAI,
  canPin,
  onPostUpdate,
  onRequestEditMeta,
  onRequestDelete,
}: {
  post: Post
  selected: boolean
  isMobile: boolean
  onToggleSelect: (id: number, checked: boolean) => void
  showAuthor: boolean
  canConfigureAI: boolean // 只有管理员可以在全局配置中配置 AI
  canPin: boolean // 只有管理员可以置顶到首页
  onPostUpdate: ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => void
  onRequestEditMeta: (post: Post) => void
  onRequestDelete: (post: Post) => void
}) => {
  const commonT = useTranslations('Common')
  const labelCount = isMobile ? 1 : 3
  const postT = useTranslations('Console.post_edit')
  const editorT = useTranslations('Console.editor')
  const stateT = useTranslations('State')
  const operationT = useOperationT()
  const clickToPost = useToPost()
  const aiSummary = useAISummary({ post, onPostUpdate, canConfigure: canConfigureAI })
  const pinUntilText = usePinUntilText()
  const previewOnly = Boolean(post.isPrivate || post.isDraft)
  return (
    <div>
      <div className="flex w-full items-center gap-3 py-3">
        <Checkbox
          checked={selected}
          onCheckedChange={checked => onToggleSelect(post.id, checked === true)}
          aria-label={post.title}
        />
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
              quality={45}
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
                    className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300',
                  },
                  ...(showAuthor && post.user
                    ? [{
                        value: `${postT('author')}: ${post.user.nickname || post.user.username}`,
                        className: 'bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300',
                      }]
                    : []),
                  ...(post.pinned
                    ? [{
                        value: post.pinnedUntil
                          ? `${commonT('pinned')} · ${postT('pin_until', { date: pinUntilText(post.pinnedUntil) })}`
                          : commonT('pinned'),
                        className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
                      }]
                    : []),
                  ...(post.isDraft
                    ? [{
                        value: editorT('status_draft'),
                        className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
                      }]
                    : post.hasDraft
                      ? [{
                          value: editorT('status_unpublished_changes'),
                          className: 'bg-slate-100 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300',
                        }]
                      : []),
                  {
                    value: stateT(post.isPrivate ? 'private' : 'public'),
                    className: post.isPrivate
                      ? 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300'
                      : 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
                  },
                  {
                    value: post.category
                      ? `${postT('category')}: ${post.category?.name}`
                      : postT('uncategorized'),
                    className: post.category
                      ? 'bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300'
                      : 'bg-gray-100 text-gray-800 dark:bg-zinc-500/15 dark:text-zinc-300',
                  },
                  {
                    value: labelsValue,
                    className:
                      post.labels && post.labels.length > 0
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300'
                        : 'bg-gray-100 text-gray-800 dark:bg-zinc-500/15 dark:text-zinc-300',
                    popover: labelsTruncated
                      ? (
                          <div className="grid gap-2">
                            <div className="text-xs text-muted-foreground">{`${postT('labels')} (${labels.length})`}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {labels.map(label => (
                                <Badge key={label.id} className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300" variant="secondary">
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
            aria-label={operationT(previewOnly ? 'preview' : 'view')}
            title={operationT(previewOnly ? 'preview' : 'view')}
          >
            <Eye className="size-4" />
          </Button>
          <PostDropdownMenu
            post={post}
            canPin={canPin}
            onPostUpdate={onPostUpdate}
            onRequestEditMeta={onRequestEditMeta}
            onRequestDelete={onRequestDelete}
            aiSummaryRunning={aiSummary.running}
            onTriggerAISummary={aiSummary.trigger}
          />
        </div>
      </div>
    </div>
  )
})

export function PostManage() {
  const t = useTranslations('Console.post_edit')
  const commonT = useCommonT()
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
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
  const [metaDialogOpen, setMetaDialogOpen] = useState(false)
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [deletingPost, setDeletingPost] = useState<Post | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [batchUpdating, setBatchUpdating] = useState(false)

  // 列表取数：等到 user 就绪后再发起请求，避免鉴权尚未恢复时把空结果写进缓存
  const listPosts = useConsoleQuery(
    user ? ['admin/posts', isAdminUser, page, size, orderBy, desc, debouncedQueryInput, onlyMine, onlyPinned] : null,
    async () => {
      if (isAdminUser && onlyPinned) {
        const res = await listPinnedPostsAdmin()
        return { posts: res.data.posts, total: res.data.posts.length }
      }
      const params = { page, size, orderBy, desc, query: debouncedQueryInput }
      const res = isAdminUser
        ? await listPostsAdmin({ ...params, userId: onlyMine ? user!.id : 0 })
        : await listMyPosts(params)
      return { posts: res.data.posts, total: res.data.total }
    },
    { onError: error => toast.error(`${operationT('fetch_failed')}: ${errorMessageT(error)}`) },
  )
  const posts = listPosts.data?.posts ?? EMPTY_POSTS
  const total = listPosts.data?.total ?? 0
  const loading = (!user && !listPosts.data) || (listPosts.loading && !listPosts.data)
  const { refresh: refreshPosts, setData: setPostList } = listPosts

  const activeSelectedIds = useMemo(
    () => posts.filter(p => selectedIds.has(p.id)).map(p => p.id),
    [posts, selectedIds],
  )
  const allSelected = posts.length > 0 && activeSelectedIds.length === posts.length
  const partiallySelected = activeSelectedIds.length > 0 && !allSelected

  const toggleSelectAll = useCallback((checked: boolean) => {
    setSelectedIds(checked ? new Set(posts.map(p => p.id)) : new Set())
  }, [posts])

  const toggleSelectOne = useCallback((id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked)
        next.add(id)
      else
        next.delete(id)
      return next
    })
  }, [])

  const handleBatchVisibility = async (isPrivate: boolean) => {
    if (activeSelectedIds.length === 0 || batchUpdating)
      return
    setBatchUpdating(true)
    try {
      await batchUpdatePostVisibility({ ids: activeSelectedIds, isPrivate })
      toast.success(operationT('update_success'))
      setSelectedIds(new Set())
      await refreshPosts()
    }
    catch (error) {
      toast.error(`${operationT('update_failed')}: ${errorMessageT(error)}`)
    }
    finally {
      setBatchUpdating(false)
    }
  }

  const handleBatchDelete = async () => {
    if (activeSelectedIds.length === 0)
      return
    await batchDeletePosts({ ids: activeSelectedIds })
    toast.success(operationT('delete_success'))
    const deletingAllOnPage = activeSelectedIds.length >= posts.length
    setSelectedIds(new Set())
    if (deletingAllOnPage && page > 1)
      await setPage(page - 1)
    else
      await refreshPosts()
  }

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

  const openCreatePostDialog = useCallback(() => {
    setEditingPost(null)
    setMetaDialogOpen(true)
  }, [])

  const openEditPostDialog = useCallback((post: Post) => {
    setEditingPost(post)
    setMetaDialogOpen(true)
  }, [])

  const onMetaDialogChange = useCallback(
    ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => {
      if (editingPost)
        onPostUpdate({ post })
      else
        onPostCreate()
    },
    [editingPost, onPostUpdate, onPostCreate],
  )

  const handleDeleteOne = useCallback(async () => {
    if (!deletingPost)
      return
    await deletePost({ id: deletingPost.id })
    toast.success(operationT('delete_success'))
    onPostDelete({ postId: deletingPost.id })
  }, [deletingPost, operationT, onPostDelete])

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
            <Button size="sm" onClick={openCreatePostDialog}>
              {t('create_post')}
            </Button>
          </div>
        </div>
      </div>
      <CreateOrUpdatePostMetaDialogWithoutButton
        open={metaDialogOpen}
        onOpenChange={setMetaDialogOpen}
        post={editingPost}
        onPostChange={onMetaDialogChange}
      />
      <ConfirmDialog
        open={!!deletingPost}
        onOpenChange={open => !open && setDeletingPost(null)}
        title={deletingPost?.title ? operationT('delete_confirm_title', { name: deletingPost.title }) : operationT('confirm_delete')}
        description={operationT('delete_description')}
        confirmLabel={operationT('delete')}
        errorText={operationT('delete_failed')}
        confirmVariant="destructive"
        onConfirm={handleDeleteOne}
      />
      {posts.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <Checkbox
              checked={allSelected ? true : partiallySelected ? 'indeterminate' : false}
              onCheckedChange={checked => toggleSelectAll(checked === true)}
              aria-label={t('select_all')}
            />
            <span className="text-muted-foreground">
              {activeSelectedIds.length > 0
                ? t('selected_count', { count: activeSelectedIds.length })
                : t('select_all')}
            </span>
          </label>
          {activeSelectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={batchUpdating} onClick={() => void handleBatchVisibility(false)}>
                {operationT('set_public')}
              </Button>
              <Button size="sm" variant="outline" disabled={batchUpdating} onClick={() => void handleBatchVisibility(true)}>
                {operationT('set_private')}
              </Button>
              <ConfirmDialog
                title={operationT('confirm_delete')}
                description={t('batch_delete_description', { count: activeSelectedIds.length })}
                confirmLabel={operationT('delete')}
                errorText={operationT('delete_failed')}
                confirmVariant="destructive"
                onConfirm={handleBatchDelete}
              >
                <Button size="sm" variant="destructive" disabled={batchUpdating}>
                  {operationT('delete')}
                </Button>
              </ConfirmDialog>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                {operationT('cancel')}
              </Button>
            </div>
          )}
        </div>
      )}
      <Separator className="flex-1" />
      {loading && (
        <div className="py-10 text-center text-sm text-muted-foreground">{t('loading')}</div>
      )}
      {!loading && listPosts.data && posts.length === 0 && (
        <Empty className="py-10">
          <EmptyDescription>{t(debouncedQueryInput ? 'empty_search' : 'empty')}</EmptyDescription>
        </Empty>
      )}
      {posts.map(post => (
        <div key={post.id}>
          <PostItem
            post={post}
            selected={selectedIds.has(post.id)}
            isMobile={isMobile}
            onToggleSelect={toggleSelectOne}
            showAuthor={isAdminUser}
            canConfigureAI={isAdminUser}
            canPin={isAdminUser}
            onPostUpdate={onPostUpdate}
            onRequestEditMeta={openEditPostDialog}
            onRequestDelete={setDeletingPost}
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

function PostDropdownMenu({
  post,
  canPin,
  onPostUpdate,
  onRequestEditMeta,
  onRequestDelete,
  aiSummaryRunning,
  onTriggerAISummary,
}: {
  post: Post
  canPin: boolean
  onPostUpdate: ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => void
  onRequestEditMeta: (post: Post) => void
  onRequestDelete: (post: Post) => void
  aiSummaryRunning: boolean
  onTriggerAISummary: () => void
}) {
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const clickToPost = useToPost()
  const aiSummaryLabel = useAISummaryMenuLabel(post)
  const postT = useTranslations('Console.post_edit')
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={operationT('more')} title={operationT('more')}>
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-36" align="end">
        <DropdownMenuGroup>
          {/* 用链接而不是 router.push：菜单打开时（链接挂载）就完整预取编辑器的页面与 JS，点「编辑」时不用再等 */}
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link href={getPostEditUrl({ id: post.id })} prefetch>
              {operationT('edit')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onRequestEditMeta(post)} className="cursor-pointer">
            {operationT('setting')}
          </DropdownMenuItem>
          {/* 私密文章或未首次发布草稿只在后台可见：「查看」打开后台预览 */}
          <DropdownMenuItem onClick={() => clickToPost({ post })} className="cursor-pointer">
            {operationT(post.isPrivate || post.isDraft ? 'preview' : 'view')}
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
            onSelect={() => onRequestDelete(post)}
            className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10 cursor-pointer"
          >
            {operationT('delete')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
