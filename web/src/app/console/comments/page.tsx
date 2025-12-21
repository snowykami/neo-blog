'use client'
import type { Comment } from '@/models/comment'
import type { Post } from '@/models/post'
// import type { User } from '@/models/user'
import { Separator } from '@radix-ui/react-dropdown-menu'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs'

import { useCallback, useEffect, useState } from 'react'
import { useAsyncTask } from '@snowykami/use-async-task'
import { listComments } from '@/api/comment'
import { listPosts } from '@/api/post'
import { OrderSelector } from '@/components/common/orderby-selector'

import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { SearchModeSelector } from '@/components/common/search-mode-selector'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/contexts/auth-context'
import { useDevice } from '@/contexts/device-context'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useCommonT } from '@/hooks/use-translations'
import { OrderBy, SearchMode } from '@/models/common'
import { TargetType } from '@/models/types'

const PAGE_SIZE = 15
const MOBILE_PAGE_SIZE = 10
const COMMENTS_PER_POST = 10

export default function CommentsManage() {
  const commonT = useCommonT() // 在组件内部调用钩子，确保在上下文范围内
  const metricsT = useTranslations('Metrics') // 指标相关文本（如"每页"）
  const { user } = useAuth()
  const { isMobile } = useDevice()

  // 状态管理
  const [posts, setPosts] = useState<Post[]>([])
  const [postCommentsMap, setPostCommentsMap] = useState<Record<number, Comment[]>>({}) // 文章ID -> 评论列表
  const [postCommentPage, setPostCommentPage] = useState<Record<number, number>>({}) // 文章ID -> 当前评论页
  const [totalPosts, setTotalPosts] = useState(0)

  // 排序字段
  const [orderBy, setOrderBy] = useQueryState(
    'order_by',
    parseAsStringEnum<OrderBy>(Object.values(OrderBy)) // 解析为OrderBy枚举类型
      .withDefault(OrderBy.CreatedAt) // 默认按创建时间排序
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  // 搜索选择字段
  const [searchMode, setSearchMode] = useQueryState(
    'search_mode',
    parseAsStringEnum<SearchMode>(Object.values(SearchMode))
      .withDefault(SearchMode.All) // 默认为包含模式
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )

  // 是否降序
  const [desc, setDesc] = useQueryState(
    'desc', // URL参数名：?desc=true
    parseAsBoolean.withDefault(true)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )

  const [postPage, setPostPage] = useQueryState( // 文章分页（区别于评论分页）
    'post_page',
    parseAsInteger.withDefault(1)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [postSize, setPostSize] = useQueryState(
    'post_size',
    parseAsInteger
      .withDefault(isMobile ? MOBILE_PAGE_SIZE : PAGE_SIZE)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  // 搜索词用本地状态管理，不通过 URL
  const [queryInput, setQueryInput, debounceQueryInput] = useDebouncedState(
    '',
    200,
  )

  // 使用 useAsyncTask 进行文章列表搜索并缓存结果
  const listPostsTask = useAsyncTask(
    async (pp: number, ps: number, ob: OrderBy, d: boolean, q: string) => {
      if (!user)
        return { posts: [], total: 0 }
      const res = await listPosts({
        page: pp,
        size: ps,
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
      dependencies: [postPage, postSize, orderBy, desc, debounceQueryInput, user],
      getArgs: () => [postPage, postSize, orderBy, desc, debounceQueryInput] as const,
      // 相同搜索条件在 10 秒内使用缓存，避免重复请求
      cacheTime: 10_000,
      // 根据搜索条件生成唯一的 cache key
      taskKey: (pp, ps, ob, d, q) => `listPosts-${user?.id}-${pp}-${ps}-${ob}-${d}-${q}`,
      maxRetries: 1,
    }
  )

  // 更新本地状态
  useEffect(() => {
    if (listPostsTask.data) {
      setPosts(listPostsTask.data.posts)
      setTotalPosts(listPostsTask.data.total)

      const initialPage: Record<number, number> = {}
      listPostsTask.data.posts.forEach((post) => {
        initialPage[post.id] = 1
      })
      setPostCommentPage(initialPage)
    }
  }, [listPostsTask.data])

  // 单篇文章的评论
  const fetchPostComments = useCallback(async (postId: number, page = 1) => {
    if (!user)
      return
    const res = await listComments({
      page,
      size: COMMENTS_PER_POST,
      orderBy,
      desc,
      targetType: TargetType.Post,
      targetId: postId,
      depth: 0,
      commentId: 0,
    })

    // 更新评论映射：合并已有评论（如果是加载更多）
    setPostCommentsMap(prev => ({
      ...prev,
      [postId]: page === 1
        ? res.data.comments
        : [...(prev[postId] || []), ...res.data.comments],
    }))
  }, [user, orderBy, desc])

  useEffect(() => {
    if (posts.length === 0)
      return
    posts.forEach((post) => {
      fetchPostComments(post.id, 1)
    })
  }, [posts, fetchPostComments])

  // 防抖后的搜索词变化时，重置分页
  useEffect(() => {
    setPostPage(1)
  }, [debounceQueryInput, setPostPage])

  const onOrderChange = useCallback(
    ({ orderBy, desc }: { orderBy: OrderBy, desc: boolean }) => {
      setOrderBy(orderBy)
      setDesc(desc)
      setPostPage(1)
    },
    [setOrderBy, setDesc, setPostPage],
  )
  const onPostPageChange = useCallback(
    (p: number) => {
      setPostPage(p)
    },
    [setPostPage],
  )

  // 处理评论分页（加载更多评论）
  const loadMoreComments = useCallback((postId: number) => {
    setPostCommentPage((prev) => {
      const nextPage = (prev[postId] || 1) + 1
      fetchPostComments(postId, nextPage)
      return { ...prev, [postId]: nextPage }
    })
  }, [fetchPostComments])

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-y-4">
        <div className="flex items-center gap-0">
          <Input
            type="search"
            placeholder={commonT('search')}
            value={queryInput}
            onChange={e => setQueryInput(e.target.value)}
          />
          <div className="ml-1.5">
            <SearchModeSelector initialMode={searchMode} onSearchModeChange={setSearchMode} />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <OrderSelector
            initialOrder={{ orderBy, desc }}
            onOrderChange={onOrderChange}
            orderBys={[OrderBy.CreatedAt, OrderBy.Heat, OrderBy.LikeCount]}
          />
        </div>
      </div>

      {listPostsTask.loading
        ? (
            <div className="text-center py-8">加载中...</div>
          )
        : (
            <>
              {/* 文章和评论列表 */}
              {posts.length === 0
                ? (
                    <div className="text-center py-8">没有找到文章</div>
                  )
                : (
                    posts.map(post => (
                      <div key={post.id} className="mb-8 border rounded-lg p-4">
                        {/* 文章信息 */}
                        <PostItem post={post} />
                        <Separator className="my-3" />

                        {/* 评论列表 */}
                        <div className="mt-4">
                          {/* <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            评论 (
                            {post.commentCount || 0}
                            )
                          </h4> */}

                          {postCommentsMap[post.id]?.length === 0
                            ? (
                                <div className="text-sm text-gray-500 py-2">暂无评论</div>
                              )
                            : (
                                <>
                                  {postCommentsMap[post.id]?.map(comment => (
                                    <Comments key={comment.id} comment={comment} />
                                  ))}

                                  {/* 加载更多评论按钮 */}
                                  {postCommentsMap[post.id]?.length >= (postCommentPage[post.id] || 1) * COMMENTS_PER_POST && (
                                    <button
                                      onClick={() => loadMoreComments(post.id)}
                                      className="text-sm text-blue-600 dark:text-blue-400 mt-2 hover:underline"
                                    >
                                      加载更多评论
                                    </button>
                                  )}
                                </>
                              )}
                        </div>
                      </div>
                    ))
                  )}

              {/* 文章分页控制 */}
              <div className="flex justify-center items-center py-4">
                {totalPosts > 0 && (
                  <PaginationController
                    initialPage={postPage}
                    onPageChange={onPostPageChange}
                    total={totalPosts}
                    pageSize={postSize}
                  />
                )}

                <PageSizeSelector
                  initialSize={postSize}
                  onSizeChange={(s) => {
                    setPostSize(s)
                    setPostPage(1)
                  }}
                />
                {' '}
                {metricsT('per_page')}
              </div>
            </>
          )}
    </>
  )
}

function PostItem({ post }: { post: Post }) {
  return (
    <>
      <div className="flex w-full items-center gap-3 py-3">
        <div className="flex justify-start items-center gap-4">
          <div className="flex-shrink-0 w-16 h-9 rounded-md overflow-hidden">
            {post.cover && (
              <Image
                src={post.cover}
                alt={post.title}
                width={64}
                height={36}
                className="w-full h-full object-cover"
              />
            )}
            {!post.cover && (
              <div className="w-full h-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center text-gray-500 text-xs">
                No Cover
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-medium text-gray-900 dark:text-gray-100 truncate">
              {post.title}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              发布于
              {' '}
              {new Date(post.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

function Comments({ comment }: { comment: Comment }) {
  const { user, content, createdAt, depth } = comment
  const indentStyle = { marginLeft: `${depth * 16}px` }
  return (
    <>
      <div style={indentStyle} className="flex w-full items-start gap-3 py-2">
        {/* 头像区域 */}
        <div className="flex-shrink-0 w-10 h-10 rounded-md overflow-hidden">
          {user?.avatarUrl
            ? (
                <Image
                  src={user.avatarUrl}
                  alt={user.username || '用户头像'}
                  width={40}
                  height={40}
                  className="w-full h-full object-cover"
                />
              )
            : (
                <div className="w-full h-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center text-gray-500 rounded-md">
                  {user?.username?.[0] || 'U'}
                </div>
              )}
        </div>

        {/* 用户名 + 评论内容 + 时间 区域 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap -mt-2">
            <span className="font-normal text-gray-900 dark:text-gray-100">
              {user?.username || '未知用户'}
            </span>
            <span className="text-xs text-gray-500">
              {new Date(createdAt).toLocaleString()}
            </span>
            {depth > 0 && (
              <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-600 dark:text-gray-400 rounded">
                {depth + 1}
                级评论
              </span>
            )}
          </div>

          {/* 评论内容 */}
          <div className="mt-1 text-gray-800 dark:text-gray-200 break-words">
            {content || '无评论内容'}
          </div>
        </div>
      </div>
    </>
  )
}
