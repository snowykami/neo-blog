'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { SiteShell } from '@/components/layout/site-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { useNav } from '@/contexts/nav-context'
import { splitLocalePrefix } from '@/i18n/routing'
import {
  getCommittedNavigationLocation,
  getNavigationTransitionSnapshot,
  getServerNavigationTransitionSnapshot,
  normalizeNavigationPathname,
  subscribeNavigationTransition,
} from '@/lib/navigation-transition'
import { cn } from '@/lib/utils'

const META_SKELETON_ITEMS = Array.from({ length: 4 })
const COMMENT_SKELETON_ITEMS = Array.from({ length: 2 })
// 短暂延迟门槛：已预取或命中客户端缓存的瞬时切换（< 16ms）在定时器触发前已完成，彻底避免 1 帧骨架闪烁；
// 真正走网络的冷请求则在 60ms 内（远低于 100ms 人类瞬时感知阈值）平滑亮起骨架屏
const DEFAULT_SKELETON_DELAY_MS = 60

export type LeafSkeletonKind = 'post' | 'page' | null

/**
 * 识别目标路径是否属于需要展示叶子详情骨架屏的路由（/p/:id 或 /page/:id，自动剥离多语言前缀；排除 /p/:id/share-image 等子路由）。
 * 列表页（/、/a、/c、/l、/links）使用顶部进度条与各自页内状态，绝不在 (main) 外层套多层级骨架。
 */
export function resolveLeafSkeletonKind(targetPath: string | null): LeafSkeletonKind {
  if (!targetPath)
    return null
  const { pathname } = splitLocalePrefix(targetPath)
  if (/^\/p\/[^/]+\/?$/.test(pathname))
    return 'post'
  if (/^\/page\/[^/]+\/?$/.test(pathname))
    return 'page'
  return null
}

function PostDetailSkeleton() {
  return (
    <SiteShell
      skeleton
      stickySidebar={false}
      sidebar={(
        <div className="flex h-full flex-col gap-4">
          <div className="surface-card hidden rounded-2xl bg-card p-5 lg:block">
            <div className="flex items-center gap-3">
              <Skeleton className="size-14 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-3.5 w-40 max-w-full" />
              </div>
            </div>
          </div>
          <div className="surface-card hidden rounded-2xl bg-card p-4 lg:block">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-4/5" />
            <Skeleton className="mt-2 h-4 w-3/5" />
          </div>
        </div>
      )}
    >
      <div className="surface-card rounded-2xl bg-card p-5 sm:p-7 md:p-8" aria-busy="true">
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

      <div className="surface-card rounded-2xl bg-card p-5 sm:p-7 md:p-8" aria-busy="true">
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

function PageDetailSkeleton() {
  return (
    <SiteShell
      skeleton
      stickySidebar={false}
      sidebar={(
        <div className="surface-card hidden rounded-2xl bg-card p-4 lg:block">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-4/5" />
        </div>
      )}
    >
      <div className="surface-card rounded-2xl bg-card p-5 sm:p-7 md:p-8" aria-busy="true">
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

/**
 * 仅客户端导航期间生效的叶子详情骨架过渡层：
 * - 服务端零 loading.tsx 全量直出 <article>，爬虫冷抓取不含任何 aria-busy 骨架或 hidden 占位块
 * - 空闲态与激活态保持完全一致的 div > div > children Fiber 结构（空闲态 display: contents 零盒模型开销），
 *   绝不触发 <LayoutRouter> 或 <Activity> 保活子树的卸载重挂，同时保留原页面滚动高度供浏览器返回恢复
 */
export function MainRouteTransition({
  children,
  delayMs = DEFAULT_SKELETON_DELAY_MS,
}: {
  children: React.ReactNode
  delayMs?: number
}) {
  const { fullscreen } = useNav()
  const transition = useSyncExternalStore(
    subscribeNavigationTransition,
    getNavigationTransitionSnapshot,
    getServerNavigationTransitionSnapshot,
  )

  const committedPath = getCommittedNavigationLocation()?.pathname
    ?? (typeof window !== 'undefined' ? normalizeNavigationPathname(window.location.pathname) : null)
  const isSamePathname = Boolean(
    transition.targetPath
    && committedPath
    && normalizeNavigationPathname(transition.targetPath) === committedPath,
  )
  const targetKind = transition.active && !isSamePathname
    ? resolveLeafSkeletonKind(transition.targetPath)
    : null

  const [skeletonArmed, setSkeletonArmed] = useState(false)
  if (!targetKind && skeletonArmed)
    setSkeletonArmed(false)

  useEffect(() => {
    if (!targetKind || skeletonArmed || delayMs <= 0)
      return
    const timer = setTimeout(() => {
      setSkeletonArmed(true)
    }, delayMs)
    return () => clearTimeout(timer)
  }, [delayMs, skeletonArmed, targetKind])

  const activeKind = targetKind && (delayMs <= 0 || skeletonArmed)
    ? targetKind
    : null

  return (
    <div className={activeKind ? 'grid grid-cols-[minmax(0,1fr)]' : 'contents'}>
      <div
        className={activeKind ? 'pointer-events-none invisible col-start-1 row-start-1 min-w-0 select-none' : 'contents'}
        aria-hidden={activeKind ? true : undefined}
        inert={activeKind ? true : undefined}
      >
        {children}
      </div>
      {activeKind && (
        <div
          data-client-route-skeleton={activeKind}
          className={cn(
            'col-start-1 row-start-1 min-w-0 self-start overflow-hidden',
            fullscreen
              ? 'sticky top-0 max-h-dvh'
              : 'sticky top-[var(--nav-h)] max-h-[calc(100dvh-var(--nav-h))]',
          )}
        >
          {activeKind === 'post' ? <PostDetailSkeleton /> : <PageDetailSkeleton />}
        </div>
      )}
    </div>
  )
}
