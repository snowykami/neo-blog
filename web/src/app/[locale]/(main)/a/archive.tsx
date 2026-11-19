import type { SidebarInitialData } from '@/components/blog-sidebar/sidebar-data'
import { getTranslations } from 'next-intl/server'
import BlogSidebar from '@/components/blog-sidebar'
import { SectionTitle, SiteShell } from '@/components/layout/site-shell'
import { Badge } from '@/components/ui/badge'
import { Link } from '@/i18n/navigation'
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
export async function Archive({ groups, filter, sidebarData }: { groups: ArchiveGroup[], filter: { label: string, category: string }, sidebarData?: SidebarInitialData }) {
  const [t, routeT] = await Promise.all([
    getTranslations('Archive'),
    getTranslations('Route'),
  ])
  const totalPosts = groups.reduce((sum, group) => sum + group.posts.length, 0)
  const filterText = filter.label
    ? t('filter_label', { name: filter.label })
    : filter.category
      ? t('filter_category', { name: filter.category })
      : ''

  return (
    <SiteShell
      sidebar={(
        <BlogSidebar initialData={sidebarData} />
      )}
    >
      <SectionTitle as="h1" className="mx-4 text-xl md:mx-2 md:text-2xl">
        {routeT('archive')}
        {totalPosts > 0 && <span className="ml-2 text-base font-medium text-muted-foreground tabular-nums">{totalPosts}</span>}
      </SectionTitle>
      {/* 归档正文 */}
      <div className="surface-card rounded-2xl bg-card px-4 py-6 md:px-8">
        {filterText && (
          <div className="mb-2 flex items-center gap-3 px-2 text-sm">
            <Badge variant="secondary">{filterText}</Badge>
            <Link href={mainPath.archive} className="rounded-sm text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t('clear_filter')}
            </Link>
          </div>
        )}
        {groups.map(group => (
          <div key={group.year}>
            {/* 年份行：年份、空心圆点、文章数 */}
            <div className="flex h-15 w-full flex-row items-center">
              <div className="w-16 shrink-0 text-right text-2xl font-bold text-foreground/75 tabular-nums md:w-20">
                {group.year}
              </div>
              <div className="w-10 shrink-0 md:w-12">
                <div className="relative z-10 mx-auto size-3 rounded-full outline-3 -outline-offset-2 outline-primary" />
              </div>
              <div className="min-w-0 flex-1 text-left text-muted-foreground">
                {t('posts_count', { count: group.posts.length })}
              </div>
            </div>

            {group.posts.map(post => (
              <Link
                key={post.id}
                href={post.url}
                aria-label={post.title}
                className="group block h-10 w-full rounded-lg transition-colors duration-150 hover:bg-primary/10 active:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex h-full flex-row items-center justify-start">
                  {/* 日期 */}
                  <div className="w-16 shrink-0 text-right text-sm text-muted-foreground tabular-nums md:w-20">
                    {post.date}
                  </div>
                  {/* 圆点与虚线时间轴，圆点外描边与背景同色以遮住虚线 */}
                  <div className="archive-dash-line relative flex h-full w-10 shrink-0 items-center md:w-12">
                    <div className="relative z-10 mx-auto h-1 w-1 rounded bg-foreground/40 outline-4 outline-card transition-[height,background-color,outline-color] duration-150 group-hover:h-5 group-hover:bg-primary group-hover:outline-[color-mix(in_oklab,var(--primary)_10%,var(--card))]" />
                  </div>
                  {/* 标题 */}
                  <div className="min-w-0 flex-1 truncate pr-2 text-left font-bold text-foreground/75 transition-[color,transform] duration-150 group-hover:translate-x-1 group-hover:text-primary md:pr-6">
                    {post.title}
                  </div>
                  {/* 标签 */}
                  <div className="hidden w-[18%] shrink-0 truncate text-left text-sm text-muted-foreground md:block">
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
      </div>
    </SiteShell>
  )
}
