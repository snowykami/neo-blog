import { SiteShell } from '@/components/layout/site-shell'
import { Skeleton } from '@/components/ui/skeleton'

const META_SKELETON_ITEMS = Array.from({ length: 5 })
const COMMENTS_SKELETON_ITEMS = Array.from({ length: 3 })

// 骨架屏与文章页结构保持一致：正文卡片 + 评论卡片，侧栏为关于卡与目录
export default function Loading() {
  return (
    <SiteShell
      sidebar={(
        <div className="grid gap-4">
          <div className="rounded-2xl bg-card p-4">
            <Skeleton className="aspect-square w-full rounded-xl" />
            <Skeleton className="mx-auto mt-3 h-6 w-32" />
            <Skeleton className="mx-auto mt-2 h-4 w-40" />
          </div>
          <div className="hidden rounded-2xl bg-card p-4 lg:block">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-4/5" />
            <Skeleton className="mt-2 h-4 w-3/5" />
          </div>
        </div>
      )}
    >
      <div className="rounded-2xl bg-card px-6 pt-6 pb-8 md:px-9" aria-busy="true">
        <Skeleton className="mb-3 h-6 w-48" />
        <Skeleton className="mb-3 h-10 w-3/4" />
        <div className="mb-5 flex flex-wrap gap-4 border-b border-dashed border-foreground/10 pb-5">
          {META_SKELETON_ITEMS.map((_, i) => (
            <Skeleton key={i} className="h-7 w-24" />
          ))}
        </div>
        <Skeleton className="mb-8 aspect-[2/1] w-full rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="mt-6 h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>

      <div className="rounded-2xl bg-card px-6 py-6 md:px-9 md:py-8">
        <Skeleton className="mb-6 h-7 w-40" />
        {COMMENTS_SKELETON_ITEMS.map((_, i) => (
          <div key={i} className="mb-6 flex gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </SiteShell>
  )
}
