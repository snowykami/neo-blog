import { ConsoleRouteSkeleton } from '@/components/console/route-skeleton'

// 后台页面切换时内容区的骨架：点击菜单后立即显示，侧栏与顶栏（在 layout 的 ConsoleShell 里）保持不动。
// 有子页面（编辑器、详情页）的菜单另有自己的 loading.tsx：同一菜单内跳转时外层边界不会重新显示骨架（见 posts/loading.tsx）
export default function Loading() {
  return <ConsoleRouteSkeleton />
}
