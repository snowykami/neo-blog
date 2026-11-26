'use client'

import type { Post } from '@/models/post'
import { useLocale, useTranslations } from 'next-intl'
import { parseAsInteger, useQueryState } from 'nuqs'
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { listPosts } from '@/api/post'
import { PostList } from '@/components/blog-home/post-list'
import { PaginationController } from '@/components/common/pagination'
import { SectionTitle } from '@/components/layout/site-shell'
import { useAuth } from '@/contexts/auth-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { localizePath } from '@/i18n/routing'
import { OrderBy } from '@/models/common'
import { isAdmin } from '@/utils/common/permission'

function UserPostsPageQueryBridge({
  onSync,
  setPageRef,
}: {
  onSync: (page: number) => void
  setPageRef: React.MutableRefObject<((page: number | null) => unknown) | null>
}) {
  const [page, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }),
  )

  useLayoutEffect(() => {
    setPageRef.current = setPage
    return () => {
      setPageRef.current = null
    }
  }, [setPage, setPageRef])

  useLayoutEffect(() => {
    onSync(Math.max(1, page))
  }, [onSync, page])

  return null
}

/**
 * 用户主页的文章列表：首屏第一页由服务端预渲染直接输出在 <main>，本人或管理员登录后自动在后台补齐私密文章
 */
export function UserPosts({
  userId,
  baseUrl,
  initialPosts,
}: {
  userId: number
  baseUrl: string
  initialPosts?: { posts: Post[], total: number }
}) {
  const t = useTranslations('UserPage')
  const locale = useLocale()
  const cleanPathname = localizePath(baseUrl, locale)
  const { siteInfo } = useSiteInfo()
  const { user: currentUser } = useAuth()
  const pageSize = siteInfo.postsPerPage || 10
  const canSeePrivate = !!currentUser && (currentUser.id === userId || isAdmin({ user: currentUser }))

  const [page, setPage] = useState(1)
  const [querySynced, setQuerySynced] = useState(false)
  const [posts, setPosts] = useState<Post[]>(() => initialPosts?.posts ?? [])
  const [total, setTotal] = useState(() => initialPosts?.total ?? 0)
  const [loading, setLoading] = useState(() => !initialPosts)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const pendingRetryRef = useRef(false)

  const pageRef = useRef(1)
  const loadedKeyRef = useRef<string>(initialPosts ? `${userId}:1:public` : '')
  const setUrlPageRef = useRef<((page: number | null) => unknown) | null>(null)
  const serverInitialRef = useRef(initialPosts)

  useEffect(() => {
    if (serverInitialRef.current === initialPosts)
      return
    serverInitialRef.current = initialPosts
    loadedKeyRef.current = ''
    if (pageRef.current === 1 && initialPosts && !canSeePrivate) {
      loadedKeyRef.current = `${userId}:1:public`
      setPosts(initialPosts.posts)
      setTotal(initialPosts.total)
      setLoadError(false)
      setLoading(false)
    }
  }, [canSeePrivate, initialPosts, userId])

  const applyNextPage = useCallback((nextPage: number) => {
    if (pageRef.current !== nextPage) {
      pageRef.current = nextPage
      setPage(prev => (prev === nextPage ? prev : nextPage))
      const visibility = canSeePrivate ? 'private' : 'public'
      const nextKey = `${userId}:${nextPage}:${visibility}`
      if (nextKey !== loadedKeyRef.current) {
        if (nextPage === 1 && initialPosts && !canSeePrivate) {
          loadedKeyRef.current = nextKey
          setPosts(initialPosts.posts)
          setTotal(initialPosts.total)
          setLoadError(false)
          setLoading(false)
        }
        else {
          setLoading(true)
        }
      }
    }
  }, [canSeePrivate, initialPosts, userId])

  const handlePageSync = useCallback((nextPage: number) => {
    applyNextPage(nextPage)
    setQuerySynced(true)
  }, [applyNextPage])

  useEffect(() => {
    if (!querySynced)
      return
    const forceRetry = pendingRetryRef.current
    pendingRetryRef.current = false
    const visibility = canSeePrivate ? 'private' : 'public'
    const key = `${userId}:${page}:${visibility}`

    if (page === 1 && initialPosts && !canSeePrivate && !forceRetry) {
      if (loadedKeyRef.current !== key) {
        loadedKeyRef.current = key
        setPosts(initialPosts.posts)
        setTotal(initialPosts.total)
        setLoadError(false)
        setLoading(false)
      }
      return
    }
    // Activity 从隐藏恢复显示时若当前页已加载就绪，直接保留现有列表与滚动位置
    if (loadedKeyRef.current === key && !forceRetry)
      return

    let cancelled = false
    // 本人/管理员静默刷新私密文章时不清空已有的公开文章，避免闪回骨架
    const silentRefresh = page === 1 && !!initialPosts && canSeePrivate && !forceRetry
    if (!silentRefresh)
      setLoading(true)
    setLoadError(false)
    listPosts({ userId, page, size: pageSize, orderBy: OrderBy.CreatedAt, desc: true })
      .then((res) => {
        if (cancelled)
          return
        loadedKeyRef.current = key
        setPosts(res.data.posts || [])
        setTotal(res.data.total || 0)
      })
      .catch(() => {
        if (!cancelled && !silentRefresh) {
          setPosts([])
          setTotal(0)
          setLoadError(true)
        }
      })
      .finally(() => {
        if (!cancelled)
          setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canSeePrivate, initialPosts, page, pageSize, querySynced, reloadKey, userId])

  return (
    <section className="grid gap-4">
      <Suspense fallback={null}>
        <UserPostsPageQueryBridge onSync={handlePageSync} setPageRef={setUrlPageRef} />
      </Suspense>
      <SectionTitle className="mx-4 text-xl md:mx-2 md:text-2xl">
        {t('posts')}
        {total > 0 && <span className="ml-2 text-base font-medium text-muted-foreground tabular-nums">{total}</span>}
      </SectionTitle>
      <PostList
        posts={posts}
        showAuthor={false}
        isLoading={loading}
        skeletonCount={pageSize}
        error={loadError}
        onRetry={() => {
          loadedKeyRef.current = ''
          pendingRetryRef.current = true
          setReloadKey(k => k + 1)
        }}
      />
      {total > 0 && (
        <PaginationController
          hideOnSinglePage
          className="flex justify-center pt-2"
          pageSize={pageSize}
          page={page}
          total={total}
          buildHref={p => (p === 1 ? cleanPathname : `${cleanPathname}?page=${p}`)}
          onPageChange={(next) => {
            setUrlPageRef.current?.(next)
            applyNextPage(next)
            const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
          }}
        />
      )}
    </section>
  )
}
