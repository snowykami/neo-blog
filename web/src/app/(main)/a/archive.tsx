'use client'
import { motion } from 'motion/react'
import BlogSidebar from '@/components/blog-sidebar'
import { BlogSidebarAbout, BlogSidebarHotPosts, BlogSidebarLabels, SidebarMisskeyIframe } from '@/components/blog-sidebar/blog-sidebar-card'
import { useSiteInfo } from '@/contexts/site-info-context'
import { OrderBy } from '@/models/common'
import { navStickyTopPx } from '@/utils/common/layout-size'

export function Archive() {
  const { siteInfo } = useSiteInfo()
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
          <p>这里是博客文章的归档页面。</p>
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
