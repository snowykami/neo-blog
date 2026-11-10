import { PostList } from '@/components/blog-home/post-list'
import { SiteShell } from '@/components/layout/site-shell'
import { Skeleton } from '@/components/ui/skeleton'

/*
 * 分类详情骨架：标题 + 与列表加载态相同的文章行，侧栏只画占位卡片
 * （真实侧栏的标签云、热门文章会在挂载时各自取数，放进骨架里会在页面到达后重复请求）。
 * 不存在的分类在 page.tsx 的 generateMetadata 里判定 404
 */
export default function Loading() {
  return (
    <SiteShell
      sidebar={(
        <div className="grid gap-4">
          <div className="rounded-2xl bg-card p-4">
            <Skeleton className="aspect-square w-full rounded-xl" />
            <Skeleton className="mx-auto mt-3 h-6 w-32" />
          </div>
          <div className="rounded-2xl bg-card p-4">
            <Skeleton className="h-6 w-24" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-14" />
            </div>
          </div>
        </div>
      )}
    >
      <div className="grid gap-1 px-4 md:px-2">
        <Skeleton className="h-7 w-48 md:h-8" />
      </div>
      <PostList posts={[]} isLoading />
    </SiteShell>
  )
}
