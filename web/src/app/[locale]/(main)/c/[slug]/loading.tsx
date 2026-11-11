import { PostList } from '@/components/blog-home/post-list'
import { BlogSidebarSkeleton } from '@/components/blog-sidebar/sidebar-skeleton'
import { SiteShell } from '@/components/layout/site-shell'
import { Skeleton } from '@/components/ui/skeleton'

/*
 * 分类详情骨架：标题 + 与列表加载态相同的文章行，侧栏只画占位卡片
 * （真实侧栏的标签云、热门文章会在挂载时各自取数，放进骨架里会在页面到达后重复请求）。
 * 不依赖地址参数，属于所有分类页共用的 App Shell；不存在的分类在页面里判定 404（见 page.tsx）
 */
export default function Loading() {
  return (
    <SiteShell
      sidebar={<BlogSidebarSkeleton />}
    >
      <div className="grid gap-1 px-4 md:px-2">
        <Skeleton className="h-7 w-48 md:h-8" />
      </div>
      <PostList posts={[]} isLoading />
    </SiteShell>
  )
}
