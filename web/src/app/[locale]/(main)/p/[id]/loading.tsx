import { BlogSidebarAbout } from '@/components/blog-sidebar/blog-sidebar-card'
import { SiteShell } from '@/components/layout/site-shell'
import { Skeleton } from '@/components/ui/skeleton'

const META_SKELETON_ITEMS = Array.from({ length: 4 })
const COMMENT_SKELETON_ITEMS = Array.from({ length: 2 })

/*
 * 文章页骨架：没预取到的点击立刻切到这里，正文到了再替换；版式与 blog-post.tsx 一致（正文卡片 + 评论卡片，侧栏为关于卡与目录）。
 * 关于卡直接用真实组件（只读站点信息，不发请求）；不画封面占位：多数文章没有封面，画了反而在正文到达时大幅跳动。
 * 不依赖地址参数：属于所有文章共用的 App Shell，没预取到正文的点击（键盘回车、手机轻点）立刻显示；404 与 slug 跳转在页面里判定（见 post-data.ts）
 */
export default function Loading() {
  return (
    <SiteShell
      stickySidebar={false}
      sidebar={(
        <div className="flex h-full flex-col gap-4">
          <BlogSidebarAbout />
          <div className="hidden rounded-2xl bg-card p-4 lg:sticky lg:top-[calc(var(--nav-h)+1rem)] lg:block">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-4/5" />
            <Skeleton className="mt-2 h-4 w-3/5" />
          </div>
        </div>
      )}
    >
      <div className="rounded-2xl bg-card px-6 pt-6 pb-8 md:px-9" aria-busy="true">
        <Skeleton className="mb-3 h-6 w-64 max-w-full" />
        <Skeleton className="mb-3 h-9 w-3/4 md:h-11" />
        <div className="mb-5 flex flex-wrap gap-4 border-b border-dashed border-foreground/10 pb-5">
          {META_SKELETON_ITEMS.map((_, i) => (
            <Skeleton key={i} className="h-7 w-24" />
          ))}
        </div>
        <div className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="mt-6 h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>

      <div className="rounded-2xl bg-card px-6 py-6 md:px-9 md:py-8" aria-busy="true">
        <Skeleton className="mb-6 h-8 w-48" />
        <div className="space-y-6">
          {COMMENT_SKELETON_ITEMS.map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SiteShell>
  )
}
