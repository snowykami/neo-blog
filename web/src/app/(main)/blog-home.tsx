'use client'

import type { BlogHomeInitialData } from './blog-home-query'
import type { Post } from '@/models/post'
import { Clock, TrendingUp, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { parseAsInteger, useQueryState } from 'nuqs'
import { useEffect, useRef, useState } from 'react'
import { listPosts } from '@/api/post'
import { PostList } from '@/components/blog-home/post-list'
import BlogSidebar from '@/components/blog-sidebar'
import { PaginationController } from '@/components/common/pagination'
import { SectionTitle, SiteShell } from '@/components/layout/site-shell'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useStoredState } from '@/hooks/use-storage-state'
import { OrderBy } from '@/models/common'
import { blogHomeQueryKey } from './blog-home-query'

export default function BlogHome({ initialData }: { initialData?: BlogHomeInitialData }) {
  // 从路由查询参数中获取页码和标签们
  const t = useTranslations('BlogHome')
  const { siteInfo } = useSiteInfo()
  // 筛选条件来自 URL：?label=标签 &category=分类 &query=搜索词，与后端列表接口参数一致
  const [labelSlug, setLabelSlug] = useQueryState('label')
  const [categorySlug, setCategorySlug] = useQueryState('category')
  const [query, setQuery] = useQueryState('query')
  const [page, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [posts, setPosts] = useState<Post[]>(initialData?.posts ?? [])
  const [totalPosts, setTotalPosts] = useState(initialData?.total ?? 0)
  const initialKeyRef = useRef(initialData?.key)
  const [loading, setLoading] = useState(false)
  // 加载失败标记与重试计数：重试时自增以重新触发请求
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [orderByState, setOrderByState, isOrderByStateLoaded] = useStoredState<OrderBy>(
    'order_by',
    OrderBy.CreatedAt,
  )

  // 区分浏览器 history popstate（回退/前进）与用户主动触发的分页
  const popStateRef = useRef(false)
  useEffect(() => {
    const onPop = () => {
      popStateRef.current = true
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 监听 page 变化，只有在非 popstate 情况下滚动到顶部
  useEffect(() => {
    if (popStateRef.current) {
      // 清除标记，不执行滚动（这是浏览器回退/前进恢复）
      popStateRef.current = false
      return
    }
    // 用户主动触发分页时滚动
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [page, labelSlug, categorySlug, query])

  useEffect(() => {
    if (!isOrderByStateLoaded)
      return
    const orderBy = orderByState === OrderBy.CreatedAt ? OrderBy.CreatedAt : OrderBy.Heat
    // 首次查询与服务端预取参数一致时复用预取结果
    const key = blogHomeQueryKey({ page, label: labelSlug, category: categorySlug, query, orderBy })
    // 参数变化后预取结果即失效（不在命中时清除，开发模式下 effect 会执行两次）
    if (initialKeyRef.current === key && reloadKey === 0)
      return
    initialKeyRef.current = undefined
    setLoading(true)
    setLoadError(false)
    listPosts({
      page,
      size: siteInfo.postsPerPage || 9,
      orderBy,
      desc: true,
      query: query || undefined,
      label: labelSlug || undefined,
      category: categorySlug || undefined,
    })
      .then((res) => {
        setPosts(res.data.posts)
        setTotalPosts(res.data.total)
        setLoading(false)
      })
      .catch((err) => {
        console.error(err)
        setLoadError(true)
        setLoading(false)
      })
  }, [query, labelSlug, categorySlug, page, orderByState, isOrderByStateLoaded, siteInfo.postsPerPage, reloadKey])

  // 标题随筛选条件变化：标签/分类优先显示名称（从返回的文章中取，取不到则用 slug），其次搜索词
  const order = orderByState === OrderBy.CreatedAt ? 'latest' : 'hottest'
  const findName = (items: { slug: string, name: string }[], slug: string) =>
    items.find(item => item.slug === slug || item.name === slug)?.name ?? slug
  const filter = labelSlug
    ? { key: 'filtered_by_label', name: findName(posts.flatMap(post => post.labels ?? []), labelSlug) }
    : categorySlug
      ? { key: 'filtered_by_category', name: findName(posts.flatMap(post => (post.category ? [post.category] : [])), categorySlug) }
      : query
        ? { key: 'filtered_by_query', name: query }
        : null
  const clearFilter = () => {
    setLabelSlug(null)
    setCategorySlug(null)
    setQuery(null)
    setPage(1)
  }

  const handleSortChange = (type: OrderBy) => {
    if (orderByState !== type) {
      setOrderByState(type)
      setPage(1)
    }
  }

  const handlePageChange = (page: number) => {
    // 仅设置 page，滚动逻辑由上面的 effect 处理（会避开 popstate）
    setPage(page)
  }

  return (
    <SiteShell
      sidebar={(
        <BlogSidebar label={labelSlug} setLabel={setLabelSlug} />
      )}
    >
      {/* 列表标题与排序 */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-2">
        <SectionTitle as="h1" className="flex min-w-0 flex-wrap items-center gap-x-2 text-xl md:text-2xl">
          <span className="min-w-0">
            {filter
              ? t.rich(filter.key as 'filtered_by_label', {
                  order,
                  name: filter.name,
                  highlight: chunks => <span className="text-primary">{chunks}</span>,
                })
              : t(order === 'latest' ? 'latest_posts' : 'hottest_posts')}
          </span>
          {totalPosts > 0 && (
            <span className="text-base font-medium text-foreground/50 tabular-nums">{totalPosts}</span>
          )}
          {filter && (
            <Button variant="ghost" size="icon-sm" className="text-foreground/50" aria-label={t('clear_filter')} title={t('clear_filter')} onClick={clearFilter}>
              <XIcon />
            </Button>
          )}
        </SectionTitle>
        {/* 排序切换 */}
        {isOrderByStateLoaded && (
          <ToggleGroup
            type="single"
            value={orderByState === OrderBy.CreatedAt ? OrderBy.CreatedAt : OrderBy.Heat}
            onValueChange={(value) => {
              if (value)
                handleSortChange(value as OrderBy)
            }}
            disabled={loading}
            className="gap-1 rounded-lg bg-card p-1"
          >
            <ToggleGroupItem
              value={OrderBy.CreatedAt}
              aria-label={t('latest')}
              className="h-9 rounded-md px-3 first:rounded-md last:rounded-md data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            >
              <Clock aria-hidden />
              {t('latest')}
            </ToggleGroupItem>
            <ToggleGroupItem
              value={OrderBy.Heat}
              aria-label={t('hottest')}
              className="h-9 rounded-md px-3 first:rounded-md last:rounded-md data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            >
              <TrendingUp aria-hidden />
              {t('hottest')}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      <PostList
        posts={posts}
        showPrivate={true}
        isLoading={loading}
        skeletonCount={siteInfo.postsPerPage || 9}
        error={loadError}
        onRetry={() => setReloadKey(k => k + 1)}
        onClearFilter={filter ? clearFilter : undefined}
      />

      {totalPosts > 0 && !loadError && (
        <PaginationController
          className="flex justify-center pt-2"
          pageSize={siteInfo.postsPerPage}
          page={page}
          total={totalPosts}
          onPageChange={handlePageChange}
        />
      )}
    </SiteShell>
  )
}
