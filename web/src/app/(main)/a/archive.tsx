'use client'
import type { Post } from '@/models/post'
import { motion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { listPosts } from '@/api/post'
import BlogSidebar from '@/components/blog-sidebar'
import { BlogSidebarAbout, BlogSidebarHotPosts, BlogSidebarLabels, SidebarMisskeyIframe } from '@/components/blog-sidebar/blog-sidebar-card'
import { useSiteInfo } from '@/contexts/site-info-context'
import { OrderBy } from '@/models/common'
import { navStickyTopPx } from '@/utils/common/layout-size'
import { getPostUrl } from '@/utils/common/route'

export function Archive() {
  const { siteInfo } = useSiteInfo()
  const [posts, setPosts] = useState<Post[]>([])

  useEffect(() => {
    listPosts({ page: 1, size: 500, orderBy: OrderBy.CreatedAt, desc: true, noContent: true })
      .then(res => setPosts(res.data.posts))
      .catch(() => setPosts([]))
  }, [])

  const groupedPosts = useMemo(() => {
    return posts.reduce<Record<string, Post[]>>((acc, post) => {
      const key = new Date(post.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit' })
      acc[key] ||= []
      acc[key].push(post)
      return acc
    }, {})
  }, [posts])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 py-4">
      {/* 归档正文 */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="lg:col-span-3 transition-none "
        transition={{
          duration: siteInfo.animationDurationSecond,
          ease: 'easeOut',
        }}
      >
        <div className="prose dark:prose-invert max-w-none">
          <h1>归档</h1>
          {Object.entries(groupedPosts).map(([month, items]) => (
            <section key={month}>
              <h2 id={month}>{month}</h2>
              <ul>
                {items.map(post => (
                  <li key={post.id}>
                    <Link href={getPostUrl({ post })}>{post.title}</Link>
                    <span className="text-muted-foreground ml-2">
                      {new Date(post.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {posts.length === 0 && <p>暂无文章</p>}
        </div>
      </motion.div>
      {/* 侧边栏 */}
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
            <BlogSidebarLabels key="tags" />,
            <BlogSidebarHotPosts key="awd12" orderType={OrderBy.CreatedAt} />,
            <SidebarMisskeyIframe key="misskey" />,
          ].filter(Boolean)}
        />
      </motion.div>
    </div>
  )
}
