'use client'
import type { Post } from '@/models/post'
import type { BaseResponseError } from '@/models/resp'
import { DropdownMenuGroup } from '@radix-ui/react-dropdown-menu'
import { useAsyncTask } from '@snowykami/use-async-task'
import { Ellipsis, Eye } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { listPostsAdmin } from '@/api/admin'
import { deletePost, listPosts, updatePost } from '@/api/post'
import { OrderSelector } from '@/components/common/orderby-selector'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { SafeImage } from '@/components/common/safe-image'
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
import { useDebouncedState } from '@/hooks/use-debounce'
import { useDoubleConfirm } from '@/hooks/use-double-confirm'
import { useIsMobile } from '@/hooks/use-mobile'
import { useToEditPost, useToPost } from '@/hooks/use-route'
import { useCommonT, useOperationT } from '@/hooks/use-translations'
import { OrderBy } from '@/models/common'
import { isAdmin } from '@/utils/common/permission'
import { CreateOrUpdatePostMetaDialogWithoutButton } from '../../../components/console/common/post-meta-dialog-form'

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
  const [posts, setPosts] = useState<Post[]>([])
  const [total, setTotal] = useState(0)
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
  const [createPostDialogOpen, setCreatePostDialogOpen] = useState(false)
  // 写操作后自增，作为缓存 key 的一部分强制重新拉取列表（reset 只清空状态，不会重新请求）
  const [refreshKey, setRefreshKey] = useState(0)

  // 使用 useAsyncTask 进行搜索并缓存结果
  const listPostsTask = useAsyncTask(
    async (p: number, sz: number, ob: OrderBy, d: boolean, q: string, mine: boolean) => {
      if (!user)
        return { posts: [], total: 0 }
      const params = { page: p, size: sz, orderBy: ob, desc: d, query: q }
      const res = isAdminUser
        ? await listPostsAdmin({ ...params, userId: mine ? user.id : 0 })
        : await listPosts({ ...params, userId: user.id })
      return { posts: res.data.posts, total: res.data.total }
    },
    {
      // 当搜索参数变化时自动执行
      immediate: true,
      dependencies: [page, size, orderBy, desc, debouncedQueryInput, onlyMine, user, refreshKey],
      getArgs: () => [page, size, orderBy, desc, debouncedQueryInput, onlyMine] as const,
      // 相同搜索条件在 10 秒内使用缓存，避免重复请求
      cacheTime: 10_000,
      // 根据搜索条件生成唯一的 cache key
      taskKey: (p, sz, ob, d, q, mine) => `listPosts-${user?.id}-${isAdminUser}-${p}-${sz}-${ob}-${d}-${q}-${mine}-${refreshKey}`,
      maxRetries: 1,
    },
  )

  // 更新本地状态
  useEffect(() => {
    if (listPostsTask.data) {
      setPosts(listPostsTask.data.posts)
      setTotal(listPostsTask.data.total)
    }
  }, [listPostsTask.data])

  // 防抖后的搜索词变化时，重置分页
  useEffect(() => {
    setPage(1)
  }, [debouncedQueryInput, setPage])

  const onPostCreate = useCallback(() => {
    // 创建新文章后重新拉取列表，新文章需要后端分配的 ID 与排序位置
    setRefreshKey(k => k + 1)
  }, [])

  const onPostUpdate = useCallback(
    ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => {
      setPosts(prev => prev.map(p => (p.id === post.id ? { ...p, ...post } : p)))
    },
    [setPosts],
  )

  const onPostDelete = useCallback(
    ({ postId }: { postId: number }) => {
      setPosts(prev => prev.filter(p => p.id !== postId))
      setTotal(prev => Math.max(0, prev - 1))
    },
    [setPosts],
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
      <div className="flex items-center justify-between mb-4 flex-wrap gap-y-4">
        <div className="flex items-center gap-3">
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
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <OrderSelector
              initialOrder={{ orderBy, desc }}
              onOrderChange={onOrderChange}
              orderBys={[
                OrderBy.Top,
                OrderBy.CreatedAt,
                OrderBy.UpdatedAt,
                OrderBy.Heat,
                OrderBy.CommentCount,
                OrderBy.LikeCount,
                OrderBy.ViewCount,
              ]}
            />
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
            onPostUpdate={onPostUpdate}
            onPostDelete={onPostDelete}
          />
          <Separator className="flex-1" />
        </div>
      ))}
      <div className="flex justify-center items-center py-4">
        {total > 0 && (
          <PaginationController
            initialPage={page}
            onPageChange={onPageChange}
            total={total}
            pageSize={size}
          />
        )}
        <PageSizeSelector
          initialSize={size}
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
  onPostUpdate,
  onPostDelete,
}: {
  post: Post
  showAuthor: boolean
  onPostUpdate: ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => void
  onPostDelete: ({ postId }: { postId: number }) => void
}) {
  const commonT = useTranslations('Common')
  const isMobile = useIsMobile()
  const labelCount = isMobile ? 1 : 3
  const postT = useTranslations('Console.post_edit')
  const stateT = useTranslations('State')
  const clickToPost = useToPost()
  const [metaDialogOpen, setMetaDialogOpen] = useState(false)
  return (
    <div>
      <div className="flex w-full items-center gap-3 py-3">
        {/* left */}
        <div className="flex justify-start items-center gap-4">
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
          <div className="min-w-0">
            <div className="text-sm font-medium">{post.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {(() => {
                const labels = post.labels || []
                const labelsValue
                  = labels.length === 0
                    ? postT('no_label')
                    : labels.length <= 3
                      ? `${postT('labels')}: ${labels.map(l => l.name).join(' | ')}`
                      : `${postT('labels')}: ${labels
                        .slice(0, labelCount)
                        .map(l => l.name)
                        .join(' | ')} ... (+${labels.length - labelCount})`

                const items: { value: string, className: string }[] = [
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
                  ...(post.top > 0
                    ? [{
                        value: `${postT('post_top')}: ${post.top}`,
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
                  },
                ]
                return items.map((item, idx) => (
                  <Badge key={idx} className={`text-xs ${item.className}`} variant="secondary">
                    {item.value}
                  </Badge>
                ))
              })()}
            </div>
          </div>
        </div>
        {/* right */}
        <div className="flex items-center ml-auto">
          <Button variant="ghost" size="sm" onClick={() => clickToPost({ post })}>
            <Eye className="inline size-4 mr-1" />
          </Button>
          <PostDropdownMenu
            post={post}
            onPostUpdate={onPostUpdate}
            onPostDelete={onPostDelete}
            setMetaDialogOpen={setMetaDialogOpen}
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
  onPostUpdate,
  onPostDelete,
  setMetaDialogOpen,
}: {
  post: Post
  onPostUpdate: ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => void
  onPostDelete: ({ postId }: { postId: number }) => void
  setMetaDialogOpen: (open: boolean) => void
}) {
  const operationT = useOperationT()
  const clickToPostEdit = useToEditPost()
  const clickToPost = useToPost()
  const {
    confirming: confirmingDelete,
    onClick: onDeleteClick,
    onBlur: onDeleteBlur,
  } = useDoubleConfirm()
  const [open, setOpen] = useState(false)
  const handleTogglePrivate = () => {
    updatePost({ post: { ...post, isPrivate: !post.isPrivate } })
      .then(() => {
        toast.success(operationT('update_success'))
        onPostUpdate({ post: { id: post.id, isPrivate: !post.isPrivate } })
      })
      .catch((error: BaseResponseError) => {
        toast.error(
          `${operationT('update_failed')}: ${error?.response?.data?.message || error.message}`,
        )
      })
  }

  const handleDelete = () => {
    deletePost({ id: post.id })
      .then(() => {
        toast.success(operationT('delete_success'))
        onPostDelete({ postId: post.id })
      })
      .catch((error: BaseResponseError) => {
        toast.error(
          `${operationT('delete_failed')}: ${error?.response?.data?.message || error.message}`,
        )
      })
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o)
          onDeleteBlur()
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">
          <Ellipsis className="w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-4" align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => clickToPostEdit({ post })} className="cursor-pointer">
            {operationT('edit')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMetaDialogOpen(true)} className="cursor-pointer">
            {operationT('setting')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => clickToPost({ post })} className="cursor-pointer">
            {operationT('view')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={handleTogglePrivate}
            className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10 cursor-pointer"
          >
            {operationT(post.isPrivate ? 'set_public' : 'set_private')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              if (!confirmingDelete) {
                e.preventDefault()
                onDeleteClick(() => handleDelete())
              }
              else {
                onDeleteClick(() => handleDelete())
              }
            }}
            className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10 cursor-pointer"
          >
            {confirmingDelete ? operationT('confirm_delete') : operationT('delete')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
