'use client'

import type { BlogHomeInitialData } from './blog-home-query'
import type { Post } from '@/models/post'
import { Clock, TrendingUp, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { parseAsInteger, useQueryState } from 'nuqs'
import { useEffect, useRef, useState } from 'react'
import { listPosts } from '@/api/post'
import { BlogCardGrid } from '@/components/blog-home/blog-home-card'
import BlogSidebar from '@/components/blog-sidebar'
import { BlogSidebarAbout, BlogSidebarLabels, SidebarMisskeyIframe } from '@/components/blog-sidebar/blog-sidebar-card'
import { PaginationController } from '@/components/common/pagination'
import { Button } from '@/components/ui/button'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useStoredState } from '@/hooks/use-storage-state'
import { OrderBy } from '@/models/common'
import { navStickyTopPx } from '@/utils/common/layout-size'
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
    if (initialKeyRef.current === key)
      return
    initialKeyRef.current = undefined
    setLoading(true)
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
        setLoading(false)
      })
  }, [query, labelSlug, categorySlug, page, orderByState, isOrderByStateLoaded, siteInfo.postsPerPage])

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
    <>
      {/* 主内容区域 */}
      <section className="py-16">
        {/* 容器 - 关键布局 */}
        <div className="">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 ">
            {/* 主要内容区域 */}
            {/* 首屏一次性 CSS 入场动画；分页 / 筛选切换时不再重放 */}
            <div className="lg:col-span-3 self-start enter-fade-up enter-delay-150">
              {/* 文章列表标题 */}
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {filter
                    ? t.rich(filter.key as 'filtered_by_label', {
                        order,
                        name: filter.name,
                        highlight: chunks => <span className="text-primary">{chunks}</span>,
                      })
                    : t(order === 'latest' ? 'latest_posts' : 'hottest_posts')}
                  {totalPosts > 0 && (
                    <span className="text-xl font-normal text-slate-500 ml-2">
                      (
                      {totalPosts}
                      )
                    </span>
                  )}
                  {filter && (
                    <Button variant="ghost" size="icon-sm" className="ml-1 align-middle text-slate-500" aria-label={t('clear_filter')} title={t('clear_filter')} onClick={clearFilter}>
                      <XIcon />
                    </Button>
                  )}
                </h2>
                {/* 排序按钮组 */}
                {isOrderByStateLoaded && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant={orderByState === OrderBy.CreatedAt ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleSortChange(OrderBy.CreatedAt)}
                      disabled={loading}
                      className="transition-all duration-200"
                    >
                      <Clock className="w-4 h-4 mr-2" />
                      {t('latest')}
                    </Button>
                    <Button
                      variant={orderByState === OrderBy.Heat ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleSortChange(OrderBy.Heat)}
                      disabled={loading}
                      className="transition-all duration-200"
                    >
                      <TrendingUp className="w-4 h-4 mr-2" />
                      {t('hottest')}
                    </Button>
                  </div>
                )}
              </div>
              {/* 博客卡片网格 */}
              <BlogCardGrid posts={posts} showPrivate={true} isLoading={loading} />
              {/* 分页控制器 */}
              <div className="mt-8">
                {totalPosts > 0 && (
                  <PaginationController
                    className="pt-4 flex justify-center"
                    pageSize={siteInfo.postsPerPage}
                    page={page}
                    total={totalPosts}
                    onPageChange={handlePageChange}
                  />
                )}
              </div>
            </div>
            <div className="sticky self-start enter-fade-up enter-delay-100" style={{ top: navStickyTopPx }}>
              <BlogSidebar
                cards={[
                  <BlogSidebarAbout key="about" />,
                  <BlogSidebarLabels key="tags" label={labelSlug} setLabel={setLabelSlug} />,
                  <SidebarMisskeyIframe key="misskey" />,
                ].filter(Boolean)}
              />
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
