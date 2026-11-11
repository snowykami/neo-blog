import { Skeleton } from '@/components/ui/skeleton'

/**
 * 侧栏占位：列表页（首页、归档、分类）的骨架里只画占位卡片。
 * 真实侧栏的标签云、热门文章在挂载时各自取数，放进骨架会在页面到达后重复请求
 */
export function BlogSidebarSkeleton() {
  return (
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
  )
}
