import type { SidebarInitialData } from '@/components/blog-sidebar/sidebar-data'
import { getTranslations } from 'next-intl/server'
import BlogSidebar from '@/components/blog-sidebar'
import { SiteShell } from '@/components/layout/site-shell'
import { ArchiveTimeline } from './archive-timeline'
import './archive.scss'

export interface ArchiveGroup {
  year: number
  posts: {
    id: number
    title: string
    url: string
    date: string // MM-DD，按站点时区在服务端算好
    labels: string[]
    labelSlugs: string[]
    categorySlug?: string
    categoryName?: string
  }[]
}

/**
 * 归档页：按年份分组的时间线，布局与交互参考 Fuwari 的 ArchivePanel（MIT License, saicaca/fuwari）
 * 左侧年份/日期，中间虚线时间轴，右侧标题与标签；悬停时圆点拉长、标题右移并高亮
 */
export async function Archive({ groups, sidebarData }: { groups: ArchiveGroup[], sidebarData?: SidebarInitialData }) {
  const routeT = await getTranslations('Route')

  return (
    <SiteShell
      sidebar={(
        <BlogSidebar initialData={sidebarData} />
      )}
    >
      <ArchiveTimeline groups={groups} archiveTitle={routeT('archive')} />
    </SiteShell>
  )
}
