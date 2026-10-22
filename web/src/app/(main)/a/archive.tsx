'use client'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import BlogSidebar from '@/components/blog-sidebar'
import { BlogSidebarAbout, BlogSidebarHotPosts, BlogSidebarLabels, SidebarMisskeyIframe } from '@/components/blog-sidebar/blog-sidebar-card'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { OrderBy } from '@/models/common'
import { navStickyTopPx } from '@/utils/common/layout-size'
import { mainPath } from '@/utils/common/route'
import './archive.scss'

export interface ArchiveGroup {
  year: number
  posts: {
    id: number
    title: string
    url: string
    date: string // MM-DD，按站点时区在服务端算好
    labels: string[]
  }[]
}

/**
 * 归档页：按年份分组的时间线，布局与交互参考 Fuwari 的 ArchivePanel（MIT License, saicaca/fuwari）
 * 左侧年份/日期，中间虚线时间轴，右侧标题与标签；悬停时圆点拉长、标题右移并高亮
 */
export function Archive({ groups, filter }: { groups: ArchiveGroup[], filter: { label: string, category: string } }) {
  const t = useTranslations('Archive')
  const filterText = filter.label
    ? t('filter_label', { name: filter.label })
    : filter.category
      ? t('filter_category', { name: filter.category })
      : ''

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 py-4">
      {/* 归档正文 */}
      {/* 首屏入场动画为纯 CSS，服务端渲染内容不会因等待水合而隐藏 */}
      <div className="lg:col-span-3 enter-fade-up enter-delay-150">
        <Card className="gap-0 px-4 py-6 md:px-8">
          {filterText && (
            <div className="mb-2 flex items-center gap-3 px-2 text-sm">
              <Badge variant="secondary">{filterText}</Badge>
              <Link href={mainPath.archive} className="text-muted-foreground hover:text-primary transition-colors">
                {t('clear_filter')}
              </Link>
            </div>
          )}
          {groups.map(group => (
            <div key={group.year}>
              {/* 年份行：年份、空心圆点、文章数 */}
              <div className="flex h-15 w-full flex-row items-center">
                <div className="w-[15%] text-right text-2xl font-bold text-foreground/75 md:w-[10%]">
                  {group.year}
                </div>
                <div className="w-[15%] md:w-[10%]">
                  <div className="relative z-10 mx-auto size-3 rounded-full outline-3 -outline-offset-2 outline-primary" />
                </div>
                <div className="w-[70%] text-left text-foreground/50 md:w-[80%]">
                  {t('posts_count', { count: group.posts.length })}
                </div>
              </div>

              {group.posts.map(post => (
                <Link
                  key={post.id}
                  href={post.url}
                  aria-label={post.title}
                  className="group block h-10 w-full rounded-lg transition-colors hover:bg-primary/10 active:bg-primary/15"
                >
                  <div className="flex h-full flex-row items-center justify-start">
                    {/* 日期 */}
                    <div className="w-[15%] text-right text-sm text-foreground/50 md:w-[10%]">
                      {post.date}
                    </div>
                    {/* 圆点与虚线时间轴，圆点外描边与背景同色以遮住虚线 */}
                    <div className="archive-dash-line relative flex h-full w-[15%] items-center md:w-[10%]">
                      <div className="relative z-10 mx-auto h-1 w-1 rounded bg-foreground/40 outline-4 outline-card transition-all group-hover:h-5 group-hover:bg-primary group-hover:outline-[color-mix(in_oklab,var(--primary)_10%,var(--card))]" />
                    </div>
                    {/* 标题 */}
                    <div className="w-[70%] truncate pr-8 text-left font-bold text-foreground/75 transition-all group-hover:translate-x-1 group-hover:text-primary md:w-[65%]">
                      {post.title}
                    </div>
                    {/* 标签 */}
                    <div className="hidden truncate text-left text-sm text-foreground/30 md:block md:w-[15%]">
                      {post.labels.map(label => `#${label}`).join(' ')}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="py-10 text-center text-muted-foreground">{t('empty')}</p>
          )}
        </Card>
      </div>
      {/* 侧边栏 */}
      <div className="sticky self-start enter-fade-up enter-delay-100" style={{ top: navStickyTopPx }}>
        <BlogSidebar
          cards={[
            <BlogSidebarAbout key="about" />,
            <BlogSidebarLabels key="tags" />,
            <BlogSidebarHotPosts key="hot-posts" orderType={OrderBy.Heat} />,
            <SidebarMisskeyIframe key="misskey" />,
          ].filter(Boolean)}
        />
      </div>
    </div>
  )
}
