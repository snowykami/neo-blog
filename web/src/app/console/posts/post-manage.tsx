'use client'
import type { Post } from '@/models/post'
import type { BaseResponseError } from '@/models/resp'
import { DropdownMenuGroup } from '@radix-ui/react-dropdown-menu'
import { useAsyncTask } from '@snowykami/use-async-task'
import { Ellipsis, Eye } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { deletePost, listPosts, updatePost } from '@/api/post'
import { OrderSelector } from '@/components/common/orderby-selector'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
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
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/contexts/auth-context'
import { useDevice } from '@/contexts/device-context'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useDoubleConfirm } from '@/hooks/use-double-confirm'
import { useIsMobile } from '@/hooks/use-mobile'
import { useToEditPost, useToPost } from '@/hooks/use-route'
import { useCommonT, useOperationT } from '@/hooks/use-translations'
import { OrderBy } from '@/models/common'
import { CreateOrUpdatePostMetaDialogWithoutButton } from '../../../components/console/common/post-meta-dialog-form'

const PAGE_SIZE = 15
const MOBILE_PAGE_SIZE = 10

export function PostManage() {
  const t = useTranslations('Console.post_edit')
  const commonT = useCommonT()
  const metricsT = useTranslations('Metrics')
  const { isMobile } = useDevice()
  const { user } = useAuth()
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
  const [createPostDialogOpen, setCreatePostDialogOpen] = useState(false)

  // 使用 useAsyncTask 进行搜索并缓存结果
  const listPostsTask = useAsyncTask(
    async (p: number, sz: number, ob: OrderBy, d: boolean, q: string) => {
      if (!user)
        return { posts: [], total: 0 }
      const res = await listPosts({
        page: p,
        size: sz,
        orderBy: ob,
        desc: d,
        query: q,
        userId: user.id,
      })
      return { posts: res.data.posts, total: res.data.total }
    },
    {
      // 当搜索参数变化时自动执行
      immediate: true,
      dependencies: [page, size, orderBy, desc, debouncedQueryInput, user],
      getArgs: () => [page, size, orderBy, desc, debouncedQueryInput] as const,
      // 相同搜索条件在 10 秒内使用缓存，避免重复请求
      cacheTime: 10_000,
      // 根据搜索条件生成唯一的 cache key
      taskKey: (p, sz, ob, d, q) => `listPosts-${user?.id}-${p}-${sz}-${ob}-${d}-${q}`,
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
    // 创建新文章后清除缓存，让下次搜索重新获取最新数据
    listPostsTask.reset()
  }, [listPostsTask])

  const onPostUpdate = useCallback(
    ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => {
      setPosts(prev => prev.map(p => (p.id === post.id ? { ...p, ...post } : p)))
    },
    [setPosts],
  )

  const onPostDelete = useCallback(
    ({ postId }: { postId: number }) => {
      setPosts(prev => prev.filter(p => p.id !== postId))
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
        <div>
          <Input
            type="search"
            placeholder={commonT('search')}
            value={queryInput}
            onChange={e => setQueryInput(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <OrderSelector initialOrder={{ orderBy, desc }} onOrderChange={onOrderChange} />
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
          <PostItem post={post} onPostUpdate={onPostUpdate} onPostDelete={onPostDelete} />
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
  onPostUpdate,
  onPostDelete,
}: {
  post: Post
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
            {post.cover && (
              <Image
                src={post.cover}
                alt={post.title}
                width={64} // 和 w-16 (4rem=64px) 保持一致
                height={36} // 和 h-9 (2.25rem=36px) 保持一致
                className="w-full h-full object-cover"
              />
            )}
            {/* 没有图片显示No Cover */}
            {!post.cover && (
              <div className="w-full h-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center text-xs text-gray-500">
                No Cover
              </div>
            )}
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
