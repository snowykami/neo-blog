import { ConsoleRouteSkeleton } from '@/components/console/route-skeleton'

// 同一菜单内的跳转（列表 ↔ 编辑器 / 详情页）只换这一层下面的路由段，外层 console/loading.tsx 的边界不会重新显示，
// 所以这一层也放一个，切换时同样先出骨架
export default function Loading() {
  return <ConsoleRouteSkeleton />
}
