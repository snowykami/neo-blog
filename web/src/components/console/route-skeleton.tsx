'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { usePathname } from '@/i18n/navigation'
import { consolePath, isConsolePreviewPath } from '@/utils/common/route'

/**
 * 后台页面的加载骨架：只画在内容区里，侧栏与顶栏不动。
 * 这里只依赖 Skeleton，不引入页面本身的组件，路由的 loading.tsx 引用它时不会把页面的 JS 拉进来
 */

/** 列表 / 表单类页面的通用骨架；登录状态确认中也用它（见 console-shell.tsx） */
export function ConsoleContentSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <Skeleton className="h-9 w-full max-w-sm" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

/** 仪表盘的卡片与图表区；页面取数时（dashboard.tsx）与路由加载时共用 */
export function DashboardSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}

/** 文章 / 页面编辑器：应用栏、工具栏与写作画布；编辑器取数时（content-editor-shell.tsx）与路由加载时共用 */
export function EditorSkeleton({ label }: { label?: string }) {
  return (
    <div className="flex flex-1 flex-col gap-3" aria-busy="true" aria-label={label}>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="mx-auto h-11 w-full max-w-[54rem] rounded-xl" />
      <Skeleton className="mx-auto h-[60vh] w-full max-w-[54rem] rounded-2xl" />
    </div>
  )
}

/** 编辑器类页面（写作画布铺满内容区） */
const EDITOR_PREFIXES = [`${consolePath.post}/edit/`, `${consolePath.page}/edit/`]

/**
 * 路由切换时的骨架（各后台 loading.tsx 共用）：点击菜单后，新页面的服务端渲染与 JS 还没到时先显示它。
 * 按目标地址选版式——客户端跳转进入加载状态时地址栏与 usePathname 已经是新地址
 */
export function ConsoleRouteSkeleton() {
  const pathname = usePathname() ?? ''
  // 文章 / 页面预览按前台的样子渲染、不套后台外壳（见 console-shell.tsx），不画后台骨架
  if (isConsolePreviewPath(pathname))
    return null
  if (pathname === consolePath.dashboard) {
    return (
      <div className="grid gap-4" aria-busy="true">
        {/* 区间说明与切换按钮那一行 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-8 w-56" />
        </div>
        <DashboardSkeleton />
      </div>
    )
  }
  if (EDITOR_PREFIXES.some(prefix => pathname.startsWith(prefix)))
    return <EditorSkeleton />
  return <ConsoleContentSkeleton />
}
