'use client'

import type { Post } from '@/models/post'
import { Clock, TrendingUp } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { parseAsInteger, useQueryState } from 'nuqs'
import { useEffect, useRef, useState } from 'react'
import { listPosts } from '@/api/post'
import { BlogCardGrid } from '@/components/blog-home/blog-home-card'
import BlogSidebar from '@/components/blog-sidebar'
import { BlogSidebarAbout, BlogSidebarCoupleSpace, BlogSidebarLabels, SidebarMisskeyIframe } from '@/components/blog-sidebar/blog-sidebar-card'
import { PaginationController } from '@/components/common/pagination'
import { Button } from '@/components/ui/button'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useStoredState } from '@/hooks/use-storage-state'
import { OrderBy } from '@/models/common'
import { navStickyTopPx } from '@/utils/common/layout-size'

export default function BlogHome() {
  // 从路由查询参数中获取页码和标签们
  const t = useTranslations('BlogHome')
  const { siteInfo } = useSiteInfo()
  const [keywords] = useState<string[]>([])
  const [labelSlug, setLabelSlug] = useQueryState('label')
  const [page, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [posts, setPosts] = useState<Post[]>([])
  const [totalPosts, setTotalPosts] = useState(0)
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
  }, [page, labelSlug])

  useEffect(() => {
    if (!isOrderByStateLoaded)
      return
    setLoading(true)
    listPosts({
      page,
      size: siteInfo.postsPerPage || 9,
      orderBy: orderByState === OrderBy.CreatedAt ? OrderBy.CreatedAt : OrderBy.Heat,
      desc: true,
      query: keywords.join(',') || undefined,
      label: labelSlug || undefined,
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
  }, [keywords, labelSlug, page, orderByState, isOrderByStateLoaded, siteInfo.postsPerPage])

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
            <motion.div
              className="lg:col-span-3 self-start transition-none"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              key={`${page}-${labelSlug ?? 'none'}`}
              transition={{
                duration: siteInfo.animationDurationSecond,
                ease: 'easeOut',
              }}
            >
              {/* 文章列表标题 */}
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {orderByState === OrderBy.CreatedAt ? t('latest_posts') : t('hottest_posts')}
                  {posts.length > 0 && (
                    <span className="text-xl font-normal text-slate-500 ml-2">
                      (
                      {posts.length}
                      )
                    </span>
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
                    initialPage={page}
                    total={totalPosts}
                    onPageChange={handlePageChange}
                  />
                )}
              </div>
            </motion.div>
            <motion.div
              className="sticky self-start"
              initial={{ x: 80, opacity: 0 }}
              animate={{ x: 0, y: 0, opacity: 1 }}
              style={{ top: navStickyTopPx }}
              transition={{
                duration: siteInfo.animationDurationSecond,
                ease: 'easeOut',
              }}
            >
              <BlogSidebar
                cards={[
                  <BlogSidebarAbout key="about" />,
                  <BlogSidebarLabels key="tags" label={labelSlug} setLabel={setLabelSlug} />,
                  <BlogSidebarCoupleSpace />,
                  <SidebarMisskeyIframe key="misskey" />,
                ].filter(Boolean)}
              />
            </motion.div>
          </div>
        </div>
      </section>
    </>
  )
}
