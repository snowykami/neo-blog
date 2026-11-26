'use client'

import type { Post } from '@/models/post'
import { useLocale } from 'next-intl'
import { parseAsInteger, useQueryState } from 'nuqs'
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { listPosts } from '@/api/post'
import { PostList } from '@/components/blog-home/post-list'
import { PaginationController } from '@/components/common/pagination'
import { localizePath } from '@/i18n/routing'
import { OrderBy } from '@/models/common'

function CategoryPageQueryBridge({
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

export function CategoryPostsClient({
  slug,
  baseUrl,
  pageSize,
  initialPosts,
  initialTotal,
}: {
  slug: string
  baseUrl: string
  pageSize: number
  initialPosts: Post[]
  initialTotal: number
}) {
  const locale = useLocale()
  const localizedBaseUrl = localizePath(baseUrl, locale)
  const [page, setPage] = useState(1)
  const [querySynced, setQuerySynced] = useState(false)
  const [posts, setPosts] = useState<Post[]>(initialPosts)
  const [total, setTotal] = useState(initialTotal)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const pendingRetryRef = useRef(false)

  const pageRef = useRef(1)
  const loadedKeyRef = useRef<string>(`${slug}:1`)
  const setUrlPageRef = useRef<((page: number | null) => unknown) | null>(null)
  const reqSeqRef = useRef(0)
  const serverPostsRef = useRef(initialPosts)

  useEffect(() => {
    if (serverPostsRef.current === initialPosts)
      return
    serverPostsRef.current = initialPosts
    loadedKeyRef.current = ''
    if (pageRef.current === 1) {
      ++reqSeqRef.current
      loadedKeyRef.current = `${slug}:1`
      setPosts(initialPosts)
      setTotal(initialTotal)
      setLoadError(false)
      setLoading(false)
    }
  }, [initialPosts, initialTotal, slug])

  const applyNextPage = useCallback((nextPage: number) => {
    if (pageRef.current !== nextPage) {
      pageRef.current = nextPage
      setPage(prev => (prev === nextPage ? prev : nextPage))
      const nextKey = `${slug}:${nextPage}`
      if (nextKey !== loadedKeyRef.current) {
        if (nextPage === 1) {
          ++reqSeqRef.current
          loadedKeyRef.current = nextKey
          setPosts(initialPosts)
          setTotal(initialTotal)
          setLoadError(false)
          setLoading(false)
        }
        else {
          setLoading(true)
        }
      }
    }
  }, [initialPosts, initialTotal, slug])

  const handleSync = useCallback((nextPage: number) => {
    applyNextPage(nextPage)
    setQuerySynced(true)
  }, [applyNextPage])

  useEffect(() => {
    if (!querySynced)
      return
    const forceRetry = pendingRetryRef.current
    pendingRetryRef.current = false
    const key = `${slug}:${page}`
    if (page === 1 && !forceRetry) {
      if (loadedKeyRef.current !== key) {
        ++reqSeqRef.current
        loadedKeyRef.current = key
        setPosts(initialPosts)
        setTotal(initialTotal)
        setLoadError(false)
        setLoading(false)
      }
      return
    }
    // Activity 从隐藏恢复显示时若当前页已加载就绪，直接保留已有 DOM 与滚动位置
    if (loadedKeyRef.current === key && !forceRetry)
      return

    const seq = ++reqSeqRef.current
    setLoading(true)
    setLoadError(false)
    listPosts({
      page,
      size: pageSize,
      category: slug,
      orderBy: OrderBy.CreatedAt,
      desc: true,
    })
      .then((res) => {
        if (seq !== reqSeqRef.current)
          return
        loadedKeyRef.current = key
        setPosts(res.data.posts || [])
        setTotal(res.data.total || 0)
        setLoading(false)
      })
      .catch(() => {
        if (seq !== reqSeqRef.current)
          return
        setLoadError(true)
        setLoading(false)
      })
  }, [initialPosts, initialTotal, page, pageSize, querySynced, reloadKey, slug])

  return (
    <>
      <Suspense fallback={null}>
        <CategoryPageQueryBridge onSync={handleSync} setPageRef={setUrlPageRef} />
      </Suspense>
      <PostList
        posts={posts}
        isLoading={loading}
        skeletonCount={pageSize}
        error={loadError}
        onRetry={() => {
          loadedKeyRef.current = ''
          pendingRetryRef.current = true
          setReloadKey(k => k + 1)
        }}
        prioritizeFirst
      />
      {total > 0 && !loadError && (
        <PaginationController
          hideOnSinglePage
          className="flex justify-center pt-2"
          pageSize={pageSize}
          page={page}
          total={total}
          buildHref={p => (p <= 1 ? localizedBaseUrl : `${localizedBaseUrl}?page=${p}`)}
          onPageChange={(next) => {
            setUrlPageRef.current?.(next)
            applyNextPage(next)
            const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
          }}
        />
      )}
    </>
  )
}
