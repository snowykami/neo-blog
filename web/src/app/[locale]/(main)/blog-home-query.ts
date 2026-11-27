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

// 保留最近 4 份首页查询快照（60s 有效期，LRU 严格受界）：
// 既避免悬停预热「最热」Tab 冲掉当前所在分页快照，又能在读者跨多路由返回首页或切换最新/最热时瞬切渲染；后台写操作触发时同步清空并递增代数防回写
const HOME_SNAPSHOT_TTL_MS = 60_000
const MAX_HOME_SNAPSHOTS = 4

export interface HomeSnapshotEntry {
  cacheKey: string
  key: string
  posts: Post[]
  total: number
  pinned: Post[]
  savedAt: number
}

const homeSnapshots = new Map<string, HomeSnapshotEntry>()
const inFlightHomeQueries = new Map<string, Promise<HomeSnapshotEntry>>()
let homeSnapshotEpoch = 0

export function getHomeSnapshotEpoch(): number {
  return homeSnapshotEpoch
}

export function buildHomeSnapshotKey(params: { locale: string, size: number, queryKey: string }) {
  return `${params.locale}|${params.size}|${params.queryKey}`
}

export function readFreshHomeSnapshot(cacheKey: string): HomeSnapshotEntry | null {
  const entry = homeSnapshots.get(cacheKey)
  if (!entry)
    return null
  if (Date.now() - entry.savedAt > HOME_SNAPSHOT_TTL_MS) {
    homeSnapshots.delete(cacheKey)
    return null
  }
  homeSnapshots.delete(cacheKey)
  homeSnapshots.set(cacheKey, entry)
  return entry
}

export function writeHomeSnapshot(entry: Omit<HomeSnapshotEntry, 'savedAt'>, expectedEpoch = homeSnapshotEpoch): HomeSnapshotEntry | null {
  if (expectedEpoch !== homeSnapshotEpoch)
    return null
  const saved: HomeSnapshotEntry = {
    ...entry,
    savedAt: Date.now(),
  }
  homeSnapshots.delete(entry.cacheKey)
  homeSnapshots.set(entry.cacheKey, saved)
  if (homeSnapshots.size > MAX_HOME_SNAPSHOTS) {
    const oldest = homeSnapshots.keys().next().value
    if (oldest !== undefined)
      homeSnapshots.delete(oldest)
  }
  return saved
}

export function fetchHomeSnapshotDedup(
  cacheKey: string,
  loader: () => Promise<Omit<HomeSnapshotEntry, 'savedAt'>>,
): Promise<HomeSnapshotEntry> {
  const existing = inFlightHomeQueries.get(cacheKey)
  if (existing)
    return existing

  const epochAtStart = homeSnapshotEpoch
  const task = loader()
    .then((payload) => {
      const written = writeHomeSnapshot(payload, epochAtStart)
      return written ?? { ...payload, savedAt: Date.now() }
    })
    .finally(() => {
      if (inFlightHomeQueries.get(cacheKey) === task)
        inFlightHomeQueries.delete(cacheKey)
    })

  inFlightHomeQueries.set(cacheKey, task)
  return task
}

export function clearHomeSnapshot() {
  homeSnapshotEpoch += 1
  homeSnapshots.clear()
  inFlightHomeQueries.clear()
}
