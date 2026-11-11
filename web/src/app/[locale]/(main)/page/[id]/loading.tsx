import { SiteShell } from '@/components/layout/site-shell'
import { Skeleton } from '@/components/ui/skeleton'

/*
 * 自定义页面骨架：不依赖地址参数，属于所有页面共用的 App Shell，没预取到正文的点击（键盘回车、手机轻点）立刻显示，正文到了再替换。
 * 版式按最常见的阅读版式（正文卡片 + 侧栏）；404 与链接页跳转在页面里判定（见 page.tsx）
 */
export default function Loading() {
  return (
    <SiteShell
      stickySidebar={false}
      sidebar={(
        <div className="hidden rounded-2xl bg-card p-4 lg:block">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-4/5" />
        </div>
      )}
    >
      <div className="rounded-2xl bg-card px-6 pt-6 pb-8 md:px-9" aria-busy="true">
        <Skeleton className="mb-5 h-9 w-3/4 md:h-11" />
        <div className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="mt-6 h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </SiteShell>
  )
}
