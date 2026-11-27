'use client'

import type { BlogHomeInitialData, HomeTab } from './blog-home-query'
import type { Post } from '@/models/post'
import { Clock, TrendingUp, XIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { parseAsInteger, parseAsStringLiteral, useQueryState } from 'nuqs'
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { listPosts } from '@/api/post'
import { PostList } from '@/components/blog-home/post-list'
import { BlogMobileOwnerBanner } from '@/components/blog-sidebar/blog-sidebar-card'
import { PaginationController } from '@/components/common/pagination'
import { SectionTitle } from '@/components/layout/site-shell'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useSiteInfo } from '@/contexts/site-info-context'
import { localizePath } from '@/i18n/routing'
import { OrderBy } from '@/models/common'
import { parseHighlightTerms } from '@/utils/common/highlight'
import {
  blogHomeQueryKey,
  buildHomeSnapshotKey,
  clearHomeSnapshot,
  fetchHomeSnapshotDedup,
  getHomeSnapshotEpoch,
  HOME_TABS,
  parseHomeTab,
  readFreshHomeSnapshot,
  writeHomeSnapshot,
} from './blog-home-query'

interface HomeQueryValues {
  labelSlug: string | null
  categorySlug: string | null
  query: string | null
  page: number
  tab: HomeTab
}

interface HomeQueryActions {
  setLabelSlug: (value: string | null) => unknown
  setCategorySlug: (value: string | null) => unknown
  setQuery: (value: string | null) => unknown
  setPage: (value: number | null) => unknown
  setTab: (value: HomeTab | null) => unknown
}

const DEFAULT_HOME_QUERY: HomeQueryValues = {
  labelSlug: null,
  categorySlug: null,
  query: null,
  page: 1,
  tab: OrderBy.CreatedAt,
}

function sameHomeQuery(a: HomeQueryValues, b: HomeQueryValues): boolean {
  return a.labelSlug === b.labelSlug
    && a.categorySlug === b.categorySlug
    && a.query === b.query
    && a.page === b.page
    && a.tab === b.tab
}

// 将 nuqs 的 useQueryState（底层调用 useSearchParams）隔离在独立的无占位 Suspense 子节点中，
// 确保首页文章列表与标题栏随服务端预渲染直接进 <main>，不在静态生成阶段挂起整块列表
function BlogHomeQueryBridge({
  onSync,
  actionsRef,
}: {
  onSync: (next: HomeQueryValues) => void
  actionsRef: React.MutableRefObject<HomeQueryActions | null>
}) {
  const [labelSlug, setLabelSlug] = useQueryState('label')
  const [categorySlug, setCategorySlug] = useQueryState('category')
  const [query, setQuery] = useQueryState('query')
  const [page, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringLiteral(HOME_TABS).withDefault(OrderBy.CreatedAt).withOptions({ history: 'replace', clearOnDefault: true }),
  )

  useLayoutEffect(() => {
    actionsRef.current = { setLabelSlug, setCategorySlug, setQuery, setPage, setTab }
    return () => {
      actionsRef.current = null
    }
  }, [actionsRef, setCategorySlug, setLabelSlug, setPage, setQuery, setTab])

  useLayoutEffect(() => {
    onSync({ labelSlug, categorySlug, query, page, tab })
  }, [categorySlug, labelSlug, onSync, page, query, tab])

  return null
}

// 首页正文（标题、排序、文章列表、分页）；页面外壳与侧栏在 page.tsx（侧栏不依赖地址参数，属于静态外壳）
export default function BlogHome({ initialData }: { initialData?: BlogHomeInitialData }) {
  // 从路由查询参数中获取页码和标签们
  const t = useTranslations('BlogHome')
  const locale = useLocale()
  const { siteInfo } = useSiteInfo()
  const [queryValues, setQueryValues] = useState<HomeQueryValues>(DEFAULT_HOME_QUERY)
  const [querySynced, setQuerySynced] = useState(false)
  const queryActionsRef = useRef<HomeQueryActions | null>(null)
  const queryValuesRef = useRef<HomeQueryValues>(DEFAULT_HOME_QUERY)
  const { labelSlug, categorySlug, query, page, tab } = queryValues

  const pageSize = siteInfo.postsPerPage || 9
  const currentQueryKey = blogHomeQueryKey({ page, label: labelSlug, category: categorySlug, query, orderBy: tab })
  const currentSnapshotKey = buildHomeSnapshotKey({ locale, size: pageSize, queryKey: currentQueryKey })
  const matchedInitial = initialData?.key === currentQueryKey ? initialData : null
  const cachedHome = matchedInitial ? null : readFreshHomeSnapshot(currentSnapshotKey)
  const seed = matchedInitial ?? cachedHome

  const [posts, setPosts] = useState<Post[]>(() => seed?.posts ?? [])
  const [totalPosts, setTotalPosts] = useState(() => seed?.total ?? 0)
  // 置顶文章：只在没有筛选时由接口返回，显示在第一页最上方；它们不在 posts 里，也不计入 totalPosts
  const [pinnedPosts, setPinnedPosts] = useState<Post[]>(() => seed?.pinned ?? [])
  // 记录当前 state 中已就绪的查询键：Activity 从隐藏恢复显示时若键未变则直接保留现有 DOM，不闪骨架也不丢滚动位置
  const loadedKeyRef = useRef<string | undefined>(seed ? currentQueryKey : undefined)
  // 服务端预取的首屏默认数据跨筛选保留在 ref 中（仅后台刷新 initialData 引用变化时更新），清除筛选回到默认页可直接复用
  const serverDataRef = useRef(initialData)
  const pendingServerRefreshRef = useRef(false)
  const [serverVersion, setServerVersion] = useState(0)
  // 请求序号：快速翻页、切换筛选或排序时只采用最后一次请求的结果，旧请求晚到不覆盖新结果
  const requestSeqRef = useRef(0)
  const [loading, setLoading] = useState(false)
  // 加载失败标记与重试计数：重试时仅单次跳过缓存强制重拉，不影响后续 Activity 保活与预取复用
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const pendingRetryRef = useRef(false)

  // 悬停或聚焦「最热」按钮时按需预热第一页热门列表快照（共享飞行中 Promise，避免悬停后立即点击发出重复请求）
  const prewarmHeatTab = useCallback(() => {
    if (!querySynced || tab === OrderBy.Heat || labelSlug || categorySlug || query)
      return
    const heatKey = blogHomeQueryKey({ page: 1, orderBy: OrderBy.Heat })
    const heatSnapKey = buildHomeSnapshotKey({ locale, size: pageSize, queryKey: heatKey })
    if (readFreshHomeSnapshot(heatSnapKey))
      return
    void fetchHomeSnapshotDedup(heatSnapKey, async () => {
      const res = await listPosts({
        page: 1,
        size: pageSize,
        orderBy: OrderBy.Heat,
        desc: true,
        withPinned: true,
      })
      return {
        cacheKey: heatSnapKey,
        key: heatKey,
        posts: res.data.posts,
        total: res.data.total,
        pinned: res.data.pinned ?? [],
      }
    }).catch(() => {})
  }, [categorySlug, labelSlug, locale, pageSize, query, querySynced, tab])

  const applyNextQuery = useCallback((next: HomeQueryValues) => {
    if (!sameHomeQuery(queryValuesRef.current, next)) {
      queryValuesRef.current = next
      setQueryValues(prev => (sameHomeQuery(prev, next) ? prev : next))
      const nextKey = blogHomeQueryKey({
        page: next.page,
        label: next.labelSlug,
        category: next.categorySlug,
        query: next.query,
        orderBy: next.tab,
      })
      if (nextKey !== loadedKeyRef.current) {
        const srv = serverDataRef.current
        if (srv && srv.key === nextKey) {
          ++requestSeqRef.current
          loadedKeyRef.current = nextKey
          setPosts(srv.posts)
          setTotalPosts(srv.total)
          setPinnedPosts(srv.pinned ?? [])
          setLoadError(false)
          setLoading(false)
        }
        else {
          const snap = readFreshHomeSnapshot(buildHomeSnapshotKey({ locale, size: pageSize, queryKey: nextKey }))
          if (snap) {
            ++requestSeqRef.current
            loadedKeyRef.current = nextKey
            setPosts(snap.posts)
            setTotalPosts(snap.total)
            setPinnedPosts(snap.pinned)
            setLoadError(false)
            setLoading(false)
          }
          else {
            setLoading(true)
          }
        }
      }
    }
  }, [locale, pageSize])

  const handleQuerySync = useCallback((next: HomeQueryValues) => {
    applyNextQuery(next)
    setQuerySynced(true)
  }, [applyNextQuery])

  // 区分浏览器 history popstate（回退/前进）与用户主动触发的分页
  const popStateRef = useRef(false)
  useEffect(() => {
    const onPop = () => {
      popStateRef.current = true
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 页码或筛选真正变化时滚到顶部（浏览器回退 / 前进恢复的除外）。用 ref 记下上次的值：从文章返回首页时，
  // 被 Activity 保留的首页重新显示会重跑 effect，值没变就不滚，停在离开时的位置；首次挂载也不滚（由路由决定滚动位置）
  const hasHydratedScrollRef = useRef(false)
  const scrollKey = JSON.stringify([page, labelSlug, categorySlug, query, tab])
  const scrollKeyRef = useRef(scrollKey)
  useEffect(() => {
    if (!querySynced)
      return
    const fromPopState = popStateRef.current
    popStateRef.current = false
    if (!hasHydratedScrollRef.current) {
      hasHydratedScrollRef.current = true
      scrollKeyRef.current = scrollKey
      return
    }
    if (scrollKeyRef.current === scrollKey)
      return
    scrollKeyRef.current = scrollKey
    if (!fromPopState) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
    }
  }, [querySynced, scrollKey])

  useEffect(() => {
    if (serverDataRef.current === initialData)
      return
    serverDataRef.current = initialData
    loadedKeyRef.current = undefined
    clearHomeSnapshot()
    pendingServerRefreshRef.current = true
    setServerVersion(v => v + 1)
  }, [initialData])

  useEffect(() => {
    if (!querySynced)
      return
    const forceServerRefresh = pendingServerRefreshRef.current
    pendingServerRefreshRef.current = false
    const forceRetry = pendingRetryRef.current
    pendingRetryRef.current = false
    const size = siteInfo.postsPerPage || 9
    const key = blogHomeQueryKey({ page, label: labelSlug, category: categorySlug, query, orderBy: tab })
    const snapshotKey = buildHomeSnapshotKey({ locale, size, queryKey: key })
    const data = serverDataRef.current

    // 命中服务端预取的默认页数据（含首次挂载、清除筛选回到首页、router.refresh 更新）
    if (data && data.key === key && !forceRetry) {
      if (loadedKeyRef.current !== key || forceServerRefresh) {
        ++requestSeqRef.current
        loadedKeyRef.current = key
        setPosts(data.posts)
        setTotalPosts(data.total)
        setPinnedPosts(data.pinned ?? [])
        setLoadError(false)
        setLoading(false)
      }
      writeHomeSnapshot({
        cacheKey: snapshotKey,
        key,
        posts: data.posts,
        total: data.total,
        pinned: data.pinned ?? [],
      })
      return
    }

    // Activity 从隐藏恢复显示时若当前查询的数据已在状态中且未强制刷新，直接保留现有列表与滚动位置
    if (loadedKeyRef.current === key && !forceRetry && !forceServerRefresh)
      return

    const cached = !forceRetry && !forceServerRefresh ? readFreshHomeSnapshot(snapshotKey) : null
    if (cached) {
      ++requestSeqRef.current
      loadedKeyRef.current = key
      setPosts(cached.posts)
      setTotalPosts(cached.total)
      setPinnedPosts(cached.pinned)
      setLoadError(false)
      setLoading(false)
      return
    }
    const seq = ++requestSeqRef.current
    setLoading(true)
    setLoadError(false)
    const retryEpoch = getHomeSnapshotEpoch()
    const runFetch = forceRetry
      ? listPosts({
          page,
          size,
          orderBy: tab,
          desc: true,
          query: query || undefined,
          label: labelSlug || undefined,
          category: categorySlug || undefined,
          withPinned: true,
        }).then(res => writeHomeSnapshot({
          cacheKey: snapshotKey,
          key,
          posts: res.data.posts,
          total: res.data.total,
          pinned: res.data.pinned ?? [],
        }, retryEpoch) ?? {
          cacheKey: snapshotKey,
          key,
          posts: res.data.posts,
          total: res.data.total,
          pinned: res.data.pinned ?? [],
          savedAt: Date.now(),
        })
      : fetchHomeSnapshotDedup(snapshotKey, async () => {
          const res = await listPosts({
            page,
            size,
            orderBy: tab,
            desc: true,
            query: query || undefined,
            label: labelSlug || undefined,
            category: categorySlug || undefined,
            withPinned: true,
          })
          return {
            cacheKey: snapshotKey,
            key,
            posts: res.data.posts,
            total: res.data.total,
            pinned: res.data.pinned ?? [],
          }
        })

    runFetch
      .then((entry) => {
        if (seq !== requestSeqRef.current)
          return
        loadedKeyRef.current = key
        setPosts(entry.posts)
        setTotalPosts(entry.total)
        setPinnedPosts(entry.pinned)
        setLoading(false)
      })
      .catch((err) => {
        if (seq !== requestSeqRef.current)
          return
        console.error(err)
        setLoadError(true)
        setLoading(false)
      })
  }, [querySynced, locale, query, labelSlug, categorySlug, page, tab, siteInfo.postsPerPage, reloadKey, serverVersion])

  // 标题随筛选条件变化：标签/分类优先显示名称（从返回的文章中取，取不到则用 slug），其次搜索词
  const order = tab === OrderBy.Heat ? 'hottest' : 'latest'
  const findName = (items: { slug: string, name: string }[], slug: string) =>
    items.find(item => item.slug === slug || item.name === slug)?.name ?? slug
  const filter = labelSlug
    ? { key: 'filtered_by_label', name: findName(posts.flatMap(post => post.labels ?? []), labelSlug) }
    : categorySlug
      ? { key: 'filtered_by_category', name: findName(posts.flatMap(post => (post.category ? [post.category] : [])), categorySlug) }
      : query
        ? { key: 'filtered_by_query', name: query }
        : null
  // 搜索结果里高亮搜索词（只在按搜索词筛选时）
  const highlightTerms = useMemo(() => parseHighlightTerms(query), [query])
  const clearFilter = () => {
    const actions = queryActionsRef.current
    actions?.setLabelSlug(null)
    actions?.setCategorySlug(null)
    actions?.setQuery(null)
    actions?.setPage(1)
    applyNextQuery({ ...queryValuesRef.current, labelSlug: null, categorySlug: null, query: null, page: 1 })
  }

  const handleSortChange = (next: HomeTab) => {
    if (next !== tab) {
      const actions = queryActionsRef.current
      actions?.setTab(next)
      actions?.setPage(1)
      applyNextQuery({ ...queryValuesRef.current, tab: next, page: 1 })
    }
  }

  const handlePageChange = (nextPage: number) => {
    // 仅设置 page，滚动逻辑由上面的 effect 处理（会避开 popstate）
    queryActionsRef.current?.setPage(nextPage)
    applyNextQuery({ ...queryValuesRef.current, page: nextPage })
  }

  const buildPageHref = (p: number) => {
    const params = new URLSearchParams()
    if (labelSlug)
      params.set('label', labelSlug)
    if (categorySlug)
      params.set('category', categorySlug)
    if (query)
      params.set('query', query)
    if (tab === OrderBy.Heat)
      params.set('tab', OrderBy.Heat)
    if (p > 1)
      params.set('page', String(p))
    const qs = params.toString()
    return qs ? `?${qs}` : localizePath('/', locale)
  }

  return (
    <>
      <Suspense fallback={null}>
        <BlogHomeQueryBridge onSync={handleQuerySync} actionsRef={queryActionsRef} />
      </Suspense>
      {page === 1 && !filter && <BlogMobileOwnerBanner />}
      {/* 列表标题与排序 */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1.5 md:px-2">
        <SectionTitle as="h1" className="flex min-w-0 flex-wrap items-center gap-x-2 text-lg md:text-xl">
          <span className="min-w-0">
            {filter
              ? t.rich(filter.key as 'filtered_by_label', {
                  order,
                  name: filter.name,
                  highlight: chunks => <span className="text-primary">{chunks}</span>,
                })
              : t(order === 'latest' ? 'latest_posts' : 'hottest_posts')}
          </span>
          {/* 全部文章数：普通文章加置顶文章（置顶只在没有筛选时返回） */}
          {totalPosts + pinnedPosts.length > 0 && (
            <span className="text-sm font-medium text-muted-foreground tabular-nums">{totalPosts + pinnedPosts.length}</span>
          )}
          {filter && (
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t('clear_filter')} title={t('clear_filter')} onClick={clearFilter}>
              <XIcon />
            </Button>
          )}
        </SectionTitle>
        {/* 排序切换 */}
        <ToggleGroup
          type="single"
          value={tab}
          onValueChange={(value) => {
            if (value)
              handleSortChange(parseHomeTab(value))
          }}
          disabled={loading}
          className="surface-card gap-1 rounded-lg bg-card p-1"
        >
          <ToggleGroupItem
            value={OrderBy.CreatedAt}
            aria-label={t('latest')}
            className="h-9 rounded-md px-3 first:rounded-md last:rounded-md data-[state=on]:bg-(--primary-soft) data-[state=on]:font-semibold data-[state=on]:text-secondary-foreground"
          >
            <Clock aria-hidden />
            {t('latest')}
          </ToggleGroupItem>
          <ToggleGroupItem
            value={OrderBy.Heat}
            aria-label={t('hottest')}
            onPointerEnter={prewarmHeatTab}
            onFocus={prewarmHeatTab}
            className="h-9 rounded-md px-3 first:rounded-md last:rounded-md data-[state=on]:bg-(--primary-soft) data-[state=on]:font-semibold data-[state=on]:text-secondary-foreground"
          >
            <TrendingUp aria-hidden />
            {t('hottest')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <PostList
        posts={posts}
        pinnedPosts={page === 1 ? pinnedPosts : []}
        listLabel={t(order === 'latest' ? 'latest_posts' : 'hottest_posts')}
        isLoading={loading}
        skeletonCount={siteInfo.postsPerPage || 9}
        error={loadError}
        onRetry={() => {
          loadedKeyRef.current = undefined
          pendingRetryRef.current = true
          setReloadKey(k => k + 1)
        }}
        onClearFilter={filter ? clearFilter : undefined}
        highlight={highlightTerms}
        prioritizeFirst={page === 1}
      />

      {totalPosts > 0 && !loadError && (
        <PaginationController
          className="flex justify-center pt-2"
          pageSize={siteInfo.postsPerPage}
          page={page}
          total={totalPosts}
          buildHref={buildPageHref}
          onPageChange={handlePageChange}
        />
      )}
    </>
  )
}
