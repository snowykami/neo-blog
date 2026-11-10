import { UserPageSkeleton } from './user'

// 路由切换时先显示与页面内加载态相同的骨架；用户是否存在在 generateMetadata 里判定（见 page.tsx）
export default function Loading() {
  return <UserPageSkeleton />
}
