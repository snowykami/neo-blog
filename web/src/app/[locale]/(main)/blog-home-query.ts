import type { Post } from '@/models/post'
import { OrderBy } from '@/models/common'

export const HOME_TABS = [OrderBy.CreatedAt, OrderBy.Heat] as const

export type HomeTab = typeof HOME_TABS[number]

// 归一化地址栏的 tab 参数
export function parseHomeTab(value: unknown): HomeTab {
  return value === OrderBy.Heat ? OrderBy.Heat : OrderBy.CreatedAt
}

// 服务端预取的首屏文章，参数与客户端默认查询一致时直接使用，避免首屏空白和重复请求
export interface BlogHomeInitialData {
  key: string
  posts: Post[]
  total: number
  pinned: Post[] // 置顶文章，只在没有筛选时返回
}

// 列表查询参数的唯一标识，服务端与客户端共用，用于判断预取结果能否复用
export function blogHomeQueryKey(params: { page: number, label?: string | null, category?: string | null, query?: string | null, orderBy: OrderBy }) {
  return [params.page, params.label ?? '', params.category ?? '', params.query ?? '', params.orderBy].join('|')
}

// 仅保留最新 1 份首页查询快照（60s 有效期，O(1) 零膨胀）：
// 常规「首页 ↔ 文章」由 Next <Activity> 原生保活；即便读者连续跨 3 个以上一级路由段导致首页被框架 BFCache 挤出，
// 返回带分页/筛选的首页时也能按「语言 + 每页条数 + 查询条件」命中内存快照瞬切渲染，且后台写操作触发时同步清空
const HOME_SNAPSHOT_TTL_MS = 60_000

export interface HomeSnapshotEntry {
  cacheKey: string
  key: string
  posts: Post[]
  total: number
  pinned: Post[]
  savedAt: number
}

let lastHomeSnapshot: HomeSnapshotEntry | null = null

export function buildHomeSnapshotKey(params: { locale: string, size: number, queryKey: string }) {
  return `${params.locale}|${params.size}|${params.queryKey}`
}

export function readFreshHomeSnapshot(cacheKey: string): HomeSnapshotEntry | null {
  if (!lastHomeSnapshot || lastHomeSnapshot.cacheKey !== cacheKey)
    return null
  if (Date.now() - lastHomeSnapshot.savedAt > HOME_SNAPSHOT_TTL_MS) {
    lastHomeSnapshot = null
    return null
  }
  return lastHomeSnapshot
}

export function writeHomeSnapshot(entry: Omit<HomeSnapshotEntry, 'savedAt'>) {
  lastHomeSnapshot = {
    ...entry,
    savedAt: Date.now(),
  }
}

export function clearHomeSnapshot() {
  lastHomeSnapshot = null
}
