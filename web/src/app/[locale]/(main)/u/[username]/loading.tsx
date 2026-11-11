import { UserPageSkeleton } from './user'

// 路由切换时先显示与页面内加载态相同的骨架（不依赖地址参数，属于所有用户页共用的 App Shell）；用户是否存在在页面里判定（见 page.tsx）
export default function Loading() {
  return <UserPageSkeleton />
}
